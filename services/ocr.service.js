const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const stoneItemSchema = {
    type: SchemaType.OBJECT,
    properties: {
        Color: { type: SchemaType.STRING },
        Shape: { type: SchemaType.STRING },
        MmSize: { type: SchemaType.STRING },
        SieveSize: { type: SchemaType.STRING },
        Weight: { type: SchemaType.NUMBER, description: "AVRG WT column" },
        Pcs: { type: SchemaType.NUMBER, description: "PCS column" },
        CtWeight: { type: SchemaType.NUMBER, description: "CT WT column" }
    },
    required: ["Color", "Shape", "MmSize", "SieveSize", "Weight", "Pcs", "CtWeight"]
};

const extractionSchema = {
    type: SchemaType.OBJECT,
    properties: {
        Stones: { type: SchemaType.ARRAY, items: stoneItemSchema },
        Metal: {
            type: SchemaType.OBJECT,
            properties: {
                Weight: { type: SchemaType.NUMBER, nullable: true },
                Quality: { type: SchemaType.STRING, nullable: true }
            }
        },
        TotalPieces: { type: SchemaType.NUMBER }
    },
    required: ["Stones", "Metal", "TotalPieces"]
};

const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

async function preprocessImage(buffer) {
    return await sharp(buffer)
        .resize(3000, null, { fit: 'inside', kernel: 'lanczos3', withoutEnlargement: false })
        .normalise()
        .sharpen({ sigma: 2 })
        .grayscale()
        .toBuffer();
}

async function extractTableWithTesseract(buffer) {
    const { data } = await Tesseract.recognize(buffer, 'eng', {
        logger: m => console.log(`[ocr] Tesseract: ${m.status}` + (m.progress ? ` (${(m.progress * 100).toFixed(0)}%)` : ''))
    });
    return data.text;
}

async function reconcileWithGemini(preprocessedBase64, ocrText, mimeType) {
    const prompt = `I have a jewelry stone specification table. Below is the raw OCR output from the table:

--- OCR OUTPUT START ---
${ocrText}
--- OCR OUTPUT END ---

Transcribe the table EXACTLY. Rules:
1. Never estimate values.
2. Never infer missing digits.
3. Every visible row in the table must appear once.
4. Preserve decimals exactly.
5. Preserve leading zeros.
6. Preserve sieve sizes exactly.
7. Preserve shape names exactly.
8. Do not merge rows.
9. Do not split rows.
10. Ignore everything outside the table.

After extraction verify:
- Sum of CT WT equals DIA WT.
- Number of rows equals visible rows.
- No duplicate rows.
- Every PCS value is an integer.
- Every CT WT equals PCS x WT (within rounding tolerance).

If any value is unreadable, return null for that field instead of guessing.

Return only JSON matching the required schema.`;

    const response = await model.generateContent({
        contents: [{
            role: 'user',
            parts: [
                { text: prompt },
                { inlineData: { mimeType, data: preprocessedBase64 } }
            ]
        }],
        generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: extractionSchema
        }
    });

    return JSON.parse(response.response.text());
}

function validateRow(row) {
    if (row.Pcs == null || row.Weight == null || row.CtWeight == null) return false;
    const expected = row.Pcs * row.Weight;
    return Math.abs(expected - row.CtWeight) < 0.02;
}

async function validateAndRetryRows(stones, preprocessedBase64, mimeType) {
    if (!stones || stones.length === 0) return stones || [];

    const ValidatedRows = [];
    const InvalidRows = [];

    for (const stone of stones) {
        if (validateRow(stone)) ValidatedRows.push(stone);
        else InvalidRows.push(stone);
    }

    if (InvalidRows.length === 0) return ValidatedRows;

    if (ValidatedRows.length === 0) {
        console.warn('[ocr] All rows failed validation. Returning raw extraction as best effort.');
        return stones;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
        const retryResponse = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    {
                        text: `These rows failed validation (PCS × WT should equal CT WT). Re-read these specific rows from the image EXACTLY. Rules: preserve decimals, leading zeros, sieve sizes, and shape names. Do not estimate. If unreadable, set that field to null:\n\n${JSON.stringify(InvalidRows, null, 2)}`
                    },
                    { inlineData: { mimeType, data: preprocessedBase64 } }
                ]
            }],
            generationConfig: {
                temperature: 0,
                responseMimeType: 'application/json',
                responseSchema: { type: SchemaType.ARRAY, items: stoneItemSchema }
            }
        });

        const retried = JSON.parse(retryResponse.response.text()) || [];
        const remaining = [];
        for (const r of retried) {
            if (validateRow(r)) ValidatedRows.push(r);
            else remaining.push(r);
        }
        InvalidRows.length = 0;
        InvalidRows.push(...remaining);
        if (InvalidRows.length === 0) break;
    }

    if (InvalidRows.length > 0) {
        // Never drop a row (that loses a whole stone). Reconcile the three related columns
        // (CT WT = PCS x WT) by trusting the two that are present, then apply safety
        // validations so nothing downstream gets NaN / negatives.
        console.warn(`[ocr] ${InvalidRows.length} rows still failing after retries — reconciling instead of dropping:`, InvalidRows);
        for (const r of InvalidRows) {
            ValidatedRows.push(reconcileRow(r));
        }
    }

    return ValidatedRows;
}

// Make a stone row internally consistent (CT WT = PCS x WT) when the OCR values disagree,
// then guard against unusable numbers. Order of trust: PCS and WT are the directly-read
// columns, so prefer recomputing CT WT; if one of them is missing, derive it from CT WT.
function reconcileRow(r) {
    const ok = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;
    const p = Number(r.Pcs), w = Number(r.Weight), c = Number(r.CtWeight);

    if (ok(p) && ok(w)) {
        r.CtWeight = +(p * w).toFixed(3);              // trust PCS & WT → recompute CT WT
    } else if (ok(p) && p > 0 && ok(c)) {
        r.Weight = +(c / p).toFixed(4);                // WT unreadable → derive from CT WT / PCS
    } else if (ok(w) && w > 0 && ok(c)) {
        r.Pcs = Math.round(c / w);                     // PCS unreadable → derive from CT WT / WT
        r.CtWeight = +(r.Pcs * w).toFixed(3);
    }

    // Safety validations: PCS is a non-negative integer, WT/CT WT are non-negative finite.
    r.Pcs = Number.isFinite(Number(r.Pcs)) ? Math.max(0, Math.round(Number(r.Pcs))) : 0;
    r.Weight = Number.isFinite(Number(r.Weight)) ? Math.max(0, Number(r.Weight)) : 0;
    r.CtWeight = Number.isFinite(Number(r.CtWeight)) ? Math.max(0, Number(r.CtWeight)) : 0;
    return r;
}

module.exports = { preprocessImage, extractTableWithTesseract, reconcileWithGemini, validateRow, validateAndRetryRows };
