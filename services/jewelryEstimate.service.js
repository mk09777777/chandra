const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const {
    resolvePricingContext,
    calculatePricingEngine,
    formatPricingResponse,
} = require('./pricing.service');
const { normalizeShape } = require('../utils/shapes');
const clientService = require('./client.service');
const codelistsService = require('./codelists.service');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Matrix axes -------------------------------------------------------------
const METALS = (process.env.ESTIMATOR_METALS || '10K,14K,18K,22K,Silver 925')
    .split(',').map(s => s.trim()).filter(Boolean);
const STONE_TYPES = (process.env.ESTIMATOR_STONE_TYPES || 'NaturalRegular,NaturalLower,CVDLabGrown')
    .split(',').map(s => s.trim()).filter(Boolean);

// Approximate metal densities (g/cc). Non-10K grams are derived from the AI's
// 10K estimate by the density ratio (same physical ring, different metal).
const DENSITY = {
    '10K': 11.42, '14K': 13.07, '18K': 15.58, '22K': 17.80,
    'Silver 925': 10.36, 'Platinum': 21.45,
};
const BASE_DENSITY = DENSITY['10K'];

// Round-brilliant approximation: a 6.5 mm round ≈ 1.00 ct.
const MM_PER_CARAT = 6.5;

const RING_SIZE_DEFAULT = 7;
const MAX_ADDITIONAL = 5;
const MAX_INLINE_BYTES = 10 * 1024 * 1024;

const SYSTEM_PROMPT = `You are an expert jewelry CAD estimator and jewelry manufacturing specialist.

Your task is to analyze jewelry images and descriptions and estimate the manufacturing bill of materials.

You must estimate:
- Stone shape
- Stone carat weight
- Stone size in millimeters
- Stone count
- Estimated 10K gold weight

Rules:
- Return valid JSON only.
- Do not return markdown.
- Use confidence values between 0 and 1.
- If uncertain, return null.
- Never hallucinate values.
- Be conservative in estimates.
- Analyze all images together.

Metal weight rules:
- Assume 10K gold.
- Assume ring size 7 if ring size is not provided.
- Use all images when estimating metal weight.

Never estimate:
- Natural vs lab
- Diamond quality
- Diamond color
- Metal purity
- Price
- Labor`;

const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        stones: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    shape: { type: SchemaType.STRING, nullable: true },
                    weightCarat: { type: SchemaType.NUMBER, nullable: true },
                    sizeMM: { type: SchemaType.NUMBER, nullable: true },
                    count: { type: SchemaType.NUMBER },
                    confidence: { type: SchemaType.NUMBER },
                },
                required: ['shape', 'count', 'confidence'],
            },
        },
        estimated10KWeightGrams: { type: SchemaType.NUMBER },
        confidence: { type: SchemaType.NUMBER },
    },
    required: ['stones', 'estimated10KWeightGrams', 'confidence'],
};

const model = genAI.getGenerativeModel({
    model: process.env.ESTIMATOR_MODEL || 'gemini-2.5-pro',
    systemInstruction: SYSTEM_PROMPT,
});

// Ordered, labeled image list: topView → sideView → fortyFiveView → additional[].
function orderedImages(files) {
    const pick = (field) => (files?.[field]?.[0]) || null;
    const ordered = [];
    const top = pick('topView');
    if (top) ordered.push({ label: 'Top view of the ring', file: top });
    const side = pick('sideView');
    if (side) ordered.push({ label: 'Side view of the ring', file: side });
    const fortyFive = pick('fortyFiveView');
    if (fortyFive) ordered.push({ label: '45 degree view of the ring', file: fortyFive });
    const additional = (files?.additional || []).slice(0, MAX_ADDITIONAL);
    additional.forEach((file, i) => ordered.push({ label: `Additional image ${i + 1}`, file }));
    return ordered;
}

function buildUserParts({ images, description }) {
    const parts = [{
        text: `User Description:\n${description || '(none provided)'}\n\n`
            + `If a ring size is mentioned in the description above, use it; otherwise assume ring size ${RING_SIZE_DEFAULT}.\n\n`
            + `Analyze all uploaded ring images and estimate:\n`
            + `1. Stone shape\n2. Stone carat weight\n3. Stone size in millimeters\n`
            + `4. Stone count\n5. Estimated 10K gold weight\n6. Confidence scores\n\nReturn valid JSON only.`,
    }];
    images.forEach((img, i) => {
        if (img.file.buffer.length > MAX_INLINE_BYTES) {
            throw Object.assign(new Error(`Image "${img.label}" exceeds the 10MB inline limit`), { status: 400 });
        }
        parts.push({ text: `\n\nImage ${i + 1}: ${img.label}` });
        parts.push({ inlineData: { mimeType: img.file.mimetype, data: img.file.buffer.toString('base64') } });
    });
    return parts;
}

function validateEstimate(parsed) {
    if (!parsed || typeof parsed !== 'object') throw new Error('Estimate is not an object');
    if (!Array.isArray(parsed.stones) || parsed.stones.length === 0) throw new Error('Estimate missing stones');
    if (!(Number(parsed.estimated10KWeightGrams) >= 0)) throw new Error('estimated10KWeightGrams must be >= 0');
    if (!(parsed.confidence >= 0 && parsed.confidence <= 1)) throw new Error('confidence must be between 0 and 1');
    for (const s of parsed.stones) {
        if (!(Number(s.count) > 0)) throw new Error('stone.count must be > 0');
        if (!(s.confidence >= 0 && s.confidence <= 1)) throw new Error('stone.confidence must be between 0 and 1');
        if (s.sizeMM != null && !(Number(s.sizeMM) > 0)) throw new Error('stone.sizeMM must be null or > 0');
        if (s.weightCarat != null && !(Number(s.weightCarat) > 0)) throw new Error('stone.weightCarat must be null or > 0');
    }
    return parsed;
}

async function callLLM(userParts) {
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

const round2 = (n) => Math.round(n * 100) / 100;

// Turn one AI stone into the engine's stone shape, deriving CtWeight + an mm size
// usable by findStoneMatch (which matches on Type+Shape+MmSize, falling back to weight).
function toPricingStone(aiStone, type) {
    const count = Number(aiStone.count) || 0;
    const code = normalizeShape(aiStone.shape);

    let perStoneCarat;
    let mm;
    if (aiStone.weightCarat != null) {
        perStoneCarat = Number(aiStone.weightCarat);
        mm = aiStone.sizeMM != null ? Number(aiStone.sizeMM) : MM_PER_CARAT * Math.cbrt(perStoneCarat);
    } else if (aiStone.sizeMM != null) {
        mm = Number(aiStone.sizeMM);
        perStoneCarat = Math.pow(mm / MM_PER_CARAT, 3);
    } else {
        perStoneCarat = 0;
        mm = 0;
    }

    return {
        Type: type,
        Color: '',
        Shape: code,
        MmSize: mm > 0 ? String(round2(mm)) : '',
        SieveSize: '',
        Weight: round2(perStoneCarat),
        Pcs: count,
        CtWeight: round2(perStoneCarat * count),
        Markup: 0,
    };
}

function convertWeight(grams10K, metalQuality) {
    const density = DENSITY[metalQuality];
    if (!density) return round2(grams10K); // unknown metal: keep base weight
    return round2(grams10K * (density / BASE_DENSITY));
}

// Price one (metal × stoneType) cell using the engine's exported building blocks,
// deliberately skipping calculatePricing's generatePricingMessage (an OpenAI call).
async function priceCell({ estimate, clientId, metalQuality, stoneType }) {
    const metalWeightGrams = convertWeight(Number(estimate.estimated10KWeightGrams), metalQuality);
    const stones = estimate.stones.map(s => toPricingStone(s, stoneType));
    const totalPieces = stones.reduce((sum, s) => sum + (s.Pcs || 0), 0);

    const pricingDetails = {
        Metal: { Weight: metalWeightGrams, Quality: metalQuality },
        Stones: stones,
        Quantity: 1,
        TotalPieces: totalPieces,
    };

    const context = await resolvePricingContext(pricingDetails, clientId, false);
    const calc = calculatePricingEngine(context);
    const pricing = formatPricingResponse(context, calc);

    return { metalQuality, stoneType, metalWeightGrams, pricing };
}

exports.estimateAndPrice = async ({ files, clientId, description }) => {
    const images = orderedImages(files);
    if (images.length === 0 || !files?.topView?.[0]) {
        throw Object.assign(new Error('Top view image is required'), { status: 400 });
    }

    const userParts = buildUserParts({ images, description });

    let estimate;
    try {
        estimate = validateEstimate(await callLLM(userParts));
    } catch (first) {
        console.warn('[jewelryEstimate] first LLM attempt failed, retrying once:', first.message);
        estimate = validateEstimate(await callLLM(userParts));
    }

    // Limit the stone-type axis to the client's applicable types (canonical-cased so the
    // pricing engine matches Type exactly); fall back to the default set when none are configured.
    const client = await clientService.getClient(clientId).catch(() => null);
    const applicable = await codelistsService.canonicalizeStoneTypes(client?.ApplicableStoneTypes || []);
    const stoneTypes = applicable.length ? applicable : STONE_TYPES;

    const matrix = [];
    for (const metalQuality of METALS) {
        for (const stoneType of stoneTypes) {
            matrix.push(await priceCell({ estimate, clientId, metalQuality, stoneType }));
        }
    }

    return {
        estimate: {
            stones: estimate.stones,
            estimated10KWeightGrams: estimate.estimated10KWeightGrams,
            confidence: estimate.confidence,
        },
        matrix,
    };
};
