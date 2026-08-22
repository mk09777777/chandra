const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2';
const EMBED_URL = `https://generativelanguage.googleapis.com/v1/models/${EMBED_MODEL}:embedContent?key=${process.env.GEMINI_API_KEY}`;

async function generateEmbedding(buffer, mimeType) {
    const base64 = buffer.toString('base64');
    const resp = await fetch(EMBED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: `models/${EMBED_MODEL}`,
            content: {
                parts: [{ inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } }],
            },
            outputDimensionality: 1536,
        }),
    });

    if (!resp.ok) {
        throw new Error(`Embedding API error ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json();
    return data.embedding.values;
}

async function generateTextEmbedding(text) {
    const resp = await fetch(EMBED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text }] },
            outputDimensionality: 1536,
        }),
    });

    if (!resp.ok) {
        throw new Error(`Text embedding API error ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json();
    return data.embedding.values;
}

module.exports = { generateEmbedding, generateTextEmbedding };
