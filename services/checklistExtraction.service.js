const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_INSTRUCTION = `You are an expert jewelry manufacturing instruction extraction assistant.

Your task is to analyze customer instructions and extract information that matches the checklist below.

CHECKLIST FIELDS

1. Engraving
2. Size - Length
3. Size - Ring Size
4. Dimensions (Thickness)
5. Delivery Date
6. Enamel / Paintwork
7. Rhodium Instructions
8. Components
9. Findings

FINDINGS EXAMPLES
- Chain - Light
- Chain - Medium
- Chain - Heavy
- Nutpost
- Lock - Handmade
- Lock - Ready Made

INSTRUCTIONS

- Read the customer instructions carefully.
- Extract only information that is explicitly stated by the customer.
- Do not infer, assume, calculate, or guess missing information.
- Preserve the customer's wording whenever possible.
- If a field is not mentioned, return "NA".
- Return every field even if its value is "NA".
- Findings is a single field. If a finding is mentioned, return the exact finding. Otherwise return "NA".
- If multiple values are provided for a field, combine them into a single string.
- Return valid JSON only.
- Do not include markdown.
- Do not include explanations.
- Do not include notes.
- Do not include any text before or after the JSON.

OUTPUT JSON SCHEMA

{
  "engraving": "string | NA",
  "size_length": "string | NA",
  "size_ring_size": "string | NA",
  "dimensions_thickness": "string | NA",
  "delivery_date": "string | NA",
  "enamel_paintwork": "string | NA",
  "rhodium_instructions": "string | NA",
  "components": "string | NA",
  "findings": "string | NA"
}`;

const checklistResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        engraving: { type: SchemaType.STRING },
        size_length: { type: SchemaType.STRING },
        size_ring_size: { type: SchemaType.STRING },
        dimensions_thickness: { type: SchemaType.STRING },
        delivery_date: { type: SchemaType.STRING },
        enamel_paintwork: { type: SchemaType.STRING },
        rhodium_instructions: { type: SchemaType.STRING },
        components: { type: SchemaType.STRING },
        findings: { type: SchemaType.STRING },
    },
    required: [
        'engraving',
        'size_length',
        'size_ring_size',
        'dimensions_thickness',
        'delivery_date',
        'enamel_paintwork',
        'rhodium_instructions',
        'components',
        'findings',
    ],
};

const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_INSTRUCTION,
});

function buildInstructionsText({ remarks, specialRemarks }) {
    const parts = [];
    if (remarks && String(remarks).trim()) parts.push(`Remarks: ${String(remarks).trim()}`);
    if (specialRemarks && String(specialRemarks).trim()) parts.push(`Special Remarks: ${String(specialRemarks).trim()}`);
    return parts.join('\n\n');
}

exports.extractChecklist = async ({ remarks, specialRemarks }) => {
    const instructionsText = buildInstructionsText({ remarks, specialRemarks });
    if (!instructionsText) return null;

    try {
        const response = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [{ text: `CUSTOMER INSTRUCTIONS\n\n${instructionsText}` }],
            }],
            generationConfig: {
                temperature: 0,
                responseMimeType: 'application/json',
                responseSchema: checklistResponseSchema,
            },
        });

        const jsonString = response.response.text();
        const parsed = JSON.parse(jsonString);

        return {
            Engraving: parsed.engraving || 'NA',
            SizeLength: parsed.size_length || 'NA',
            SizeRingSize: parsed.size_ring_size || 'NA',
            DimensionsThickness: parsed.dimensions_thickness || 'NA',
            DeliveryDate: parsed.delivery_date || 'NA',
            EnamelPaintwork: parsed.enamel_paintwork || 'NA',
            RhodiumInstructions: parsed.rhodium_instructions || 'NA',
            Components: parsed.components || 'NA',
            Findings: parsed.findings || 'NA',
            GeneratedAt: new Date(),
        };
    } catch (err) {
        console.error('[extractChecklist] Gemini extraction failed:', err);
        return null;
    }
};
