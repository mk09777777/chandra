const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const enquiryService = require('./enquiry.service');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const MAX_REFERENCES = 5;
const MAX_INLINE_BYTES = 20 * 1024 * 1024; // Gemini inline-data soft limit

const SYSTEM_PROMPT = `You are an expert jewelry QA reviewer.

You may be given:
1. The IMAGE UNDER REVIEW (the production output being checked — always the first image in the request).
2. Zero or more CUSTOMER REFERENCE DESIGNS — images and/or short videos the customer originally attached to the enquiry as the desired look.
3. A textual description of the jewelry (general design + a CHECKLIST of customer requirements).

Your task has TWO parts:

PART A — CHECKLIST VERIFICATION (MANDATORY)
For EVERY checklist item provided in the description, you MUST inspect the image under review and explicitly state whether the item is visible / satisfied / missing / not visually verifiable.
- Include one point per checklist item, even if the answer is "not visually verifiable" (e.g. ring size, length, thickness, delivery date — these cannot be confirmed from an image alone, say so explicitly).
- Each point must name the checklist field and what was (or wasn't) seen.
- Quote the customer's stated value in the point.

PART B — DESIGN CONSISTENCY (regular checks)
Compare the IMAGE UNDER REVIEW against (a) the textual description AND (b) the CUSTOMER REFERENCE DESIGNS when present. Identify mismatches, missing elements, or inconsistencies.
- Focus on metal colour (white/yellow/rose), stone shapes and types, overall design coherence, obvious missing or extra elements, and any visual cue the references make obvious that the text description does not capture.
- When the customer references show variations among themselves (e.g. two different settings shown as inspiration), do NOT flag that as an issue — only flag mismatches between the image under review and the references.
- Do NOT repeat checklist points here.

Output STRICT JSON in this exact shape:
{
  "summary": "A short paragraph summarising the overall result (alignment or key concerns).",
  "issues": [
    "Checklist Verification - <checklist field> '<customer value>': <what was observed on the image>",
    "Design Consistency - <specific observation tied to the image>"
  ],
  "confidence": "high | medium | low"
}

Formatting rules for each entry in "issues":
- Each entry is ONE plain string, NOT an object.
- Each entry MUST start with one of these two headers followed by " - " (space-hyphen-space):
    "Checklist Verification - ..."  (for every checklist item)
    "Design Consistency - ..."      (for general design observations)
- Include one "Checklist Verification - ..." entry for EVERY checklist item supplied, even if it is not visually verifiable (say so explicitly in that case).
- If there are no design issues, include one entry: "Design Consistency - No issues found".

General rules:
- Each entry must be specific and directly supported by the image under review. Do NOT speculate about things not visible.
- Be conservative: if unsure, say "might be" or "unclear".
- Do NOT hallucinate details not visible.
- Do NOT output anything outside the JSON.`;

const CHECKLIST_LABELS = {
    Engraving: 'Engraving',
    SizeLength: 'Size - Length',
    SizeRingSize: 'Size - Ring Size',
    DimensionsThickness: 'Dimensions (Thickness)',
    DeliveryDate: 'Delivery Date',
    EnamelPaintwork: 'Enamel / Paintwork',
    RhodiumInstructions: 'Rhodium Instructions',
    Components: 'Components',
    Findings: 'Findings',
};

const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        summary: { type: SchemaType.STRING },
        issues: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        confidence: { type: SchemaType.STRING, enum: ['high', 'medium', 'low'] },
    },
    required: ['summary', 'issues', 'confidence'],
};

const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
});

function buildChecklistLines(checklist) {
    if (!checklist) return [];
    const lines = [];
    for (const [key, label] of Object.entries(CHECKLIST_LABELS)) {
        const value = checklist[key];
        if (value && value !== 'NA' && String(value).trim()) {
            lines.push(`- ${label}: ${String(value).trim()}`);
        }
    }
    return lines;
}

function buildDescription(enquiry) {
    const parts = [];

    if (enquiry.Category) parts.push(`Category: ${enquiry.Category}`);

    const metalQuality = enquiry.Metal?.Quality;
    const metalColor = enquiry.Metal?.Color;
    if (metalQuality || metalColor) {
        parts.push(`Metal: ${[metalColor, metalQuality].filter(Boolean).join(' ')}`);
    }

    if (enquiry.StoneType) parts.push(`Stone type: ${enquiry.StoneType}`);
    if (enquiry.Remarks) parts.push(`Remarks: ${enquiry.Remarks.trim()}`);
    if (enquiry.SpecialRemarks) parts.push(`Special remarks: ${enquiry.SpecialRemarks.trim()}`);

    const checklistLines = buildChecklistLines(enquiry.Checklist);
    if (checklistLines.length > 0) {
        parts.push(`CHECKLIST (customer requirements — verify each against the image explicitly):\n${checklistLines.join('\n')}`);
    }

    return parts.join('\n');
}

function validateLLMResponse(parsed) {
    if (!parsed || typeof parsed !== 'object') throw new Error('LLM response is not an object');
    if (typeof parsed.summary !== 'string') throw new Error('Missing summary');
    if (!Array.isArray(parsed.issues)) throw new Error('Missing issues array');
    for (const issue of parsed.issues) {
        if (typeof issue !== 'string') throw new Error('Each issue must be a string');
    }
    if (!['high', 'medium', 'low'].includes(parsed.confidence)) throw new Error('Invalid confidence value');
    return parsed;
}

async function fetchS3Bytes(key) {
    const res = await s3.send(new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
    }));
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function buildReferenceParts(enquiry) {
    const refs = Array.isArray(enquiry.ReferenceImages) ? enquiry.ReferenceImages : [];
    const totalCount = refs.length;

    const mediaRefs = refs.filter(r => {
        const m = r?.MimeType;
        return typeof m === 'string' && (m.startsWith('image/') || m.startsWith('video/'));
    });
    const skippedNonMediaCount = totalCount - mediaRefs.length;

    const capped = mediaRefs.slice(0, MAX_REFERENCES);
    const truncatedCount = mediaRefs.length - capped.length;

    const fetched = await Promise.all(capped.map(async (ref) => {
        try {
            const buffer = await fetchS3Bytes(ref.Key);
            if (buffer.length > MAX_INLINE_BYTES) {
                console.warn(`[imageValidation] skipping reference ${ref.Key} — ${buffer.length} bytes exceeds inline limit`);
                return null;
            }
            return {
                inlineData: {
                    mimeType: ref.MimeType,
                    data: buffer.toString('base64'),
                },
            };
        } catch (err) {
            console.error(`[imageValidation] failed to fetch reference ${ref.Key}:`, err);
            return null;
        }
    }));

    const parts = fetched.filter(Boolean);

    return {
        parts,
        includedCount: parts.length,
        totalCount,
        truncatedCount,
        skippedNonMediaCount,
    };
}

function buildRefsNote(refs) {
    if (refs.totalCount === 0) return null;
    const bits = [`Customer attached ${refs.totalCount} reference file${refs.totalCount === 1 ? '' : 's'} in total`];
    bits.push(`${refs.includedCount} included below`);
    if (refs.truncatedCount > 0) bits.push(`${refs.truncatedCount} omitted to bound request size`);
    if (refs.skippedNonMediaCount > 0) bits.push(`${refs.skippedNonMediaCount} non-image / non-video file(s) skipped`);
    return bits.join('; ') + '.';
}

async function callLLM({ imageBuffer, mimeType, description, referenceParts, refsNote }) {
    const userParts = [
        { text: `Jewelry description:\n${description}${refsNote ? `\n\n${refsNote}` : ''}` },
        { text: '\n\nIMAGE UNDER REVIEW:' },
        { inlineData: { mimeType, data: imageBuffer.toString('base64') } },
    ];

    if (referenceParts.length > 0) {
        userParts.push({ text: '\n\nCUSTOMER REFERENCE DESIGNS (originally attached to the enquiry):' });
        for (const part of referenceParts) userParts.push(part);
    }

    const response = await model.generateContent({
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema,
        },
    });

    return JSON.parse(response.response.text());
}

exports.validateImage = async (enquiryId, imageBuffer, mimeType) => {
    const enquiry = await enquiryService.getEnquiry(enquiryId);
    if (!enquiry) throw Object.assign(new Error('Enquiry not found'), { status: 404 });

    const description = buildDescription(enquiry);
    if (!description) throw Object.assign(new Error('Enquiry has no usable description'), { status: 400 });

    const refs = await buildReferenceParts(enquiry);
    const refsNote = buildRefsNote(refs);

    let parsed;
    try {
        parsed = await callLLM({ imageBuffer, mimeType, description, referenceParts: refs.parts, refsNote });
    } catch {
        parsed = await callLLM({ imageBuffer, mimeType, description, referenceParts: refs.parts, refsNote });
    }

    return validateLLMResponse(parsed);
};
