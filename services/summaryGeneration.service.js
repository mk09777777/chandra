const { GoogleGenerativeAI } = require('@google/generative-ai');
const clientService = require('./client.service');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_INSTRUCTION = `You are an expert jewellery production assistant writing a designer-facing brief.

You will be given an INPUT DOSSIER listing every populated field from a jewellery enquiry. Your job is to turn that dossier into a smooth, easy-to-read paragraph that a designer can scan in seconds and immediately understand what needs to be made.

OUTPUT FORMAT (Designer-Friendly Paragraph):
- Start with "[Piece Type] for [Client]"
- Follow with "[Metal Quality] [Metal Color] [Stone Type] featuring [Design Style]"
- Include "[Quantity] pcs, [Metal Weight], [Diamond Weight], [Key Dimensions]"
- Add "Budget: [Budget Range] - Special: [Key custom requirements]"

HARD RULES — DESIGNER-FRIENDLY:
- Output ONLY the paragraph. No extra text, no formatting, no code fences.
- Use natural, flowing sentences that read smoothly.
- Group related information logically.
- Make it easy to scan quickly while maintaining clarity.
- Include all critical specs but present them in a readable format.
- Avoid bullet points or list formatting - use prose.`;

const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_INSTRUCTION,
});

function hasValue(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    return true;
}

function formatWeightRange(weight) {
    if (!weight || typeof weight !== 'object') return null;
    if (hasValue(weight.Exact)) return `exactly ${weight.Exact}`;
    const from = hasValue(weight.From) ? weight.From : null;
    const to = hasValue(weight.To) ? weight.To : null;
    if (from !== null && to !== null) return `${from} – ${to}`;
    if (from !== null) return `from ${from}`;
    if (to !== null) return `up to ${to}`;
    return null;
}

function formatDate(d) {
    if (!d) return null;
    const date = (d instanceof Date) ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
}

async function buildDossier(enquiry) {
    const lines = [];

    let clientName = null;
    if (hasValue(enquiry.ClientId)) {
        try {
            const client = await clientService.getClient(enquiry.ClientId);
            if (client?.Name) clientName = client.Name;
        } catch (err) {
            console.error('[summaryGeneration] client lookup failed:', err);
        }
    }
    if (clientName) lines.push(`Client: ${clientName}`);

    if (hasValue(enquiry.Name))            lines.push(`Enquiry Name: ${enquiry.Name}`);
    if (hasValue(enquiry.StyleNumber))     lines.push(`Style Number: ${enquiry.StyleNumber}`);
    if (hasValue(enquiry.GatiOrderNumber)) lines.push(`GATI Order Number: ${enquiry.GatiOrderNumber}`);
    if (hasValue(enquiry.Category))        lines.push(`Category: ${enquiry.Category}`);
    if (hasValue(enquiry.Quantity))        lines.push(`Quantity: ${enquiry.Quantity}`);
    if (hasValue(enquiry.Priority))        lines.push(`Priority: ${enquiry.Priority}`);

    const metalColor = enquiry.Metal?.Color;
    const metalQuality = enquiry.Metal?.Quality;
    if (hasValue(metalColor))   lines.push(`Metal Colour: ${metalColor}`);
    if (hasValue(metalQuality)) lines.push(`Metal Quality: ${metalQuality}`);

    if (hasValue(enquiry.StoneType)) lines.push(`Stone Type: ${enquiry.StoneType}`);
    if (hasValue(enquiry.Stamping))  lines.push(`Stamping: ${enquiry.Stamping}`);

    const metalWeight = formatWeightRange(enquiry.MetalWeight);
    if (metalWeight) lines.push(`Metal Weight (grams): ${metalWeight}`);

    const diamondWeight = formatWeightRange(enquiry.DiamondWeight);
    if (diamondWeight) lines.push(`Diamond Weight (carats): ${diamondWeight}`);

    if (hasValue(enquiry.Budget)) lines.push(`Budget: ${enquiry.Budget}`);

    const shippingDate = formatDate(enquiry.ShippingDate);
    if (shippingDate) lines.push(`Shipping / Delivery Date: ${shippingDate}`);

    if (hasValue(enquiry.Remarks))        lines.push(`Customer Remarks: ${enquiry.Remarks.trim()}`);
    if (hasValue(enquiry.SpecialRemarks)) lines.push(`Special Remarks: ${enquiry.SpecialRemarks.trim()}`);

    return lines.join('\n');
}

exports.generateSummary = async (enquiry) => {
    if (!enquiry) return null;

    const dossier = await buildDossier(enquiry);
    if (!dossier) return null;

    try {
        const response = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [{ text: `INPUT DOSSIER\n\n${dossier}` }],
            }],
            generationConfig: {
                temperature: 0.2,
                responseMimeType: 'text/plain',
            },
        });

        const text = response.response.text();
        return text && text.trim() ? text.trim() : null;
    } catch (err) {
        console.error('[generateSummary] Gemini generation failed:', err);
        return null;
    }
};
