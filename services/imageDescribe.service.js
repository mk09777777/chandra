const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { generateEmbedding, generateTextEmbedding } = require('../utils/embedding');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const VISION_PROMPT = `You are a jewellery expert analysing a reference image for a manufacturing studio.
Extract every detail a designer would need to identify, classify, or recreate this piece.
If a measurement, weight, or dimension is clearly visible or can be reasonably estimated from the image, include it.
If a detail is not visible, omit it rather than guess.`;

const visionResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        description: { type: SchemaType.STRING },
        tags: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: '8-15 short searchable tags — include jewellery type, metal colour, setting style, stone type, design style, finish, and any notable techniques',
        },
        group: {
            type: SchemaType.STRING,
            enum: ['Bridal', 'Hip-hop', 'Cuban'],
            description: 'Bridal = delicate, floral, romantic, engagement/wedding pieces. Hip-hop = bold, iced-out, statement pieces. Cuban = link chains, thick metal, street/luxury aesthetic.',
        },
        category: {
            type: SchemaType.STRING,
            enum: ['Ring', 'Pendant', 'Bracelet', 'Earring', 'Necklace', 'Bangle', 'Chain', 'Brooch', 'Anklet', 'Other'],
        },
    },
    required: ['description', 'tags', 'group', 'category'],
};

const visionModel = genAI.getGenerativeModel({
    model: process.env.GEMINI_VISION_MODEL || 'gemini-3.6-flash',
    systemInstruction: VISION_PROMPT,
});

// Tolerates markdown-fenced JSON or surrounding prose; returns null on failure.
const safeParseJson = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try { return JSON.parse(cleaned); } catch { /* try slice */ }
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
};

/**
 * Describe an image with Gemini vision and embed the description.
 * Returns null if the file isn't an image.
 *
 * @param {{ s3Key: string, mimetype?: string }} input
 * @returns {Promise<{description: string, tags: string[], embedding: number[]} | null>}
 */
exports.describeAndEmbedImage = async ({ s3Key, mimetype }) => {
    if (mimetype && !mimetype.startsWith('image/')) return null;

    // Fetch image from S3
    const bucket = process.env.AWS_BUCKET_NAME;
    const getObj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
    const chunks = [];
    for await (const chunk of getObj.Body) chunks.push(chunk);
    const base64 = Buffer.concat(chunks).toString('base64');

    // Step 1: Embedding first (separate quota from generateContent — gemini-embedding-2 REST API)
    console.log(`[embedding] Generating embedding for ${s3Key}`);
    let embedding = null;
    try {
        embedding = await generateEmbedding(Buffer.concat(chunks), mimetype);
        console.log(`[embedding] Done for ${s3Key} (dimensions: ${embedding.length})`);
    } catch (err) {
        console.error(`[embedding] Failed for ${s3Key}:`, err.message);
        return null;
    }

    // Step 2: Vision description (optional metadata — best-effort, separate quota)
    let description = '', tags = [], group = '', category = '';
    try {
        const visionRes = await visionModel.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { text: 'Analyze this jewelry reference image.' },
                    { inlineData: { mimeType: mimetype || 'image/jpeg', data: base64 } },
                ],
            }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: visionResponseSchema },
        });
        const rawContent = visionRes.response.text();
        const parsed = safeParseJson(rawContent);
        if (parsed) {
            description = String(parsed.description || '').trim();
            tags = Array.isArray(parsed.tags) ? parsed.tags.map(String) : [];
            group = String(parsed.group || '').trim();
            category = String(parsed.category || '').trim();
        }
    } catch (err) {
        console.warn(`[vision] Skipped for ${s3Key} (quota likely exceeded):`, err.message);
    }

    // Step 3: Text embedding from description (best-effort)
    let textEmbedding = null;
    if (description) {
        try {
            textEmbedding = await generateTextEmbedding(description);
            console.log(`[embedding] Text embedding done for ${s3Key} (dims: ${textEmbedding.length})`);
        } catch (err) {
            console.warn(`[embedding] Text embedding failed for ${s3Key}:`, err.message);
        }
    }

    return { description, tags, embedding, group, category, textEmbedding };
};
