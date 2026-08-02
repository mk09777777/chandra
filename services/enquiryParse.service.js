const { GoogleGenerativeAI } = require('@google/generative-ai');
const clientService = require('./client.service');
const codelistsService = require('./codelists.service');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const REQUIRED_BY_STATUS = {
    coral:        ['Name', 'ClientId', 'Category', 'Priority', 'Metal.Color', 'Metal.Quality', 'StoneType', 'Remarks'],
    cad:          ['Name', 'ClientId', 'Category', 'Priority', 'Metal.Color', 'Metal.Quality', 'StoneType', 'Remarks'],
    approved_cad: ['Name', 'ClientId', 'Category', 'Priority', 'Metal.Color', 'Metal.Quality', 'StoneType', 'Remarks'],
};

const CATEGORY_OPTIONS = ['Ring', 'Bracelet', 'Necklace', 'Earrings', 'Pendant', 'Other'];
const PRIORITY_OPTIONS  = ['Normal', 'High', 'Super High'];
const METAL_COLOR_OPTIONS   = ['Yellow Gold', 'White Gold', 'Rose Gold', 'Two Tone Rose White Gold', 'Two Tone Yellow White Gold', 'Three Tone Rose White Yellow'];
const METAL_QUALITY_OPTIONS = ['3K', '9K', '10K', '14K', '18K', '22K', '24K', 'Silver 925', 'Platinum'];

const FIELD_LABELS = {
    'Name':          'Enquiry Name',
    'ClientId':      'Client',
    'Category':      'Category',
    'Priority':      'Priority',
    'Metal.Color':   'Metal Colour',
    'Metal.Quality': 'Metal Quality',
    'StoneType':     'Stone Type',
    'Remarks':       'Remarks',
};

const RANK = { 'Normal': 0, 'High': 1, 'Super High': 2 };
const byRank = (n) => ['Normal', 'High', 'Super High'][Math.max(0, Math.min(2, n))];
const highest = (...ps) => byRank(Math.max(...ps.map(p => RANK[p] ?? 0)));
const CLIENT_HIGH_MAX = Number(process.env.CLIENT_PRIORITY_HIGH_MAX) || 2;

function clientTierPriority(client) {
    const po = client?.PriorityOrder;
    if (po == null) return 'Normal';
    if (po === 1) return 'Super High';
    if (po <= CLIENT_HIGH_MAX) return 'High';
    return 'Normal';
}

function getNestedValue(obj, dotPath) {
    return dotPath.split('.').reduce((acc, key) => (acc != null ? acc[key] : null), obj);
}

function isMissing(value) {
    return value === null || value === undefined || value === '';
}

function toOptions(items, labelKey = 'Name', valueKey = '_id') {
    return items.map(item => ({ label: item[labelKey], value: String(item[valueKey]) }));
}

function buildMissingFields(parsed, requiredFields, optionsMap) {
    const missing = [];
    for (const field of requiredFields) {
        if (isMissing(getNestedValue(parsed, field))) {
            missing.push({
                field,
                label: FIELD_LABELS[field] || field,
                options: optionsMap[field] || [],
            });
        }
    }
    return missing;
}

function buildSystemPrompt(clientList, stoneTypeList) {
    const currentDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const currentWeekday = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });

    const clientJson = JSON.stringify(
        clientList.map(c => ({ id: String(c._id), name: c.Name, priority_order: c.PriorityOrder ?? null }))
    );

    const stoneTypeJson = JSON.stringify(
        stoneTypeList.map(v => ({ id: String(v._id), name: v.Name }))
    );

    return `You are an expert jewellery order assistant. Extract structured enquiry details from the user's message.

CURRENT DATE = ${currentDate} (${currentWeekday}). This is today. Use it as the anchor for every relative date calculation below and never assume any other current date.

Available clients (match by name from the message, return the "id" value as ClientId).
Each client has a priority_order (lower number = more important client), used as the Priority baseline (see the Priority rule below):
${clientJson}

Available stone types (match by name from the message, return the "name" value as StoneType):
${stoneTypeJson}

Return ONLY a valid JSON object with these keys (use null for anything not mentioned):
{  "Name": "<A very short, self-descriptive label (3-5 words max) that captures the enquiry's most distinctive details for search. Prioritise in this order and include only what's needed to stay unique: standout feature (e.g. carat weight or stone cut) > StoneType > Category, then client only if space allows. Drop less essential details (metal colour, metal quality) to keep it short. Example: a 4.5ct emerald-cut lab grown 18K white gold ring -> '4.5ct Emerald Lab-Grown Ring'; a 14K CVD bracelet for MK -> 'CVD Bracelet for MK'. No full sentences, no generic titles like 'Jewellery Enquiry', never null>", "Name": "<short Very specific summary of the enquiry Not a generic title, something that can be used to describe it and searchable>",
  "ClientId": "<matched client id or null>",
  "StyleNumber": "<style or design number if mentioned it would be 5 or 6 digits like R45252, E63464, etc. or null>",
  "Quantity": <number or null>,
  "Category": "<Ring|Bracelet|Necklace|Earrings|Pendant|Bangle|Other or null>",
  "Priority": "<Normal|High|Super High — Base on message urgency ONLY. If explicit urgency words (urgent, asap, rush, immediately, by tomorrow) -> 'Super High'; mild time pressure (soon, this week) -> 'High'; NO urgency mentioned -> return null>",
  "Budget": "<string or null>",
  "Metal": {
    "Color": "<Yellow Gold|White Gold|Rose Gold|Two Tone Rose White Gold|Two Tone Yellow White Gold|Three Tone Rose White Yellow| or null>",
    "Quality": "<3K|9K|10K|14K|18K|22K|24K|Silver 925|Platinum or null>"
  },
  "StoneType": "<stone type from message or null>",
  "Stamping": "<string or null>",
  "Remarks": "<copy the exact original message here>",
  "SpecialRemarks": "<any special instructions or additional notes beyond the main request or null>",
  "ShippingDate": "<ISO date string (YYYY-MM-DD) or null>. Anchor ALL calculations to CURRENT DATE above — never invent a date. The result must not be earlier than CURRENT DATE. Rules: 'today' = CURRENT DATE; 'tomorrow' or 'in 1 day' or 'after 1 day' = CURRENT DATE + 1 day; 'day after tomorrow' or 'in 2 days' or 'after 2 days' = CURRENT DATE + 2 days; 'in N days' / 'after N days' = CURRENT DATE + N days; 'in a week' / 'next week' / 'in 1 week' = CURRENT DATE + 7 days; 'in N weeks' = CURRENT DATE + (N x 7) days; 'next month' / 'in N months' = same day, N months later; 'by end of this week' = the coming Sunday; 'by end of this month' = the last day of the current month. Compute the offset by literally counting days from CURRENT DATE. If an explicit calendar date is given, use it directly. Only return null if NO date and NO time is mentioned. Return only the YYYY-MM-DD string, no time component."
}
Do not include any explanation or markdown — only the JSON object.`;
}

exports.parseEnquiryMessage = async ({ message, mediaType }) => {
    const normalizedStatus = (mediaType || 'coral').toLowerCase().replace(/\s+/g, '_');
    const requiredFields = REQUIRED_BY_STATUS[normalizedStatus] || REQUIRED_BY_STATUS.coral;

    const [clients, stoneTypeValues] = await Promise.all([
        clientService.getClients(),
        codelistsService.getCodelistByName('StoneTypes'),
    ]);

    const stoneTypeOptions = stoneTypeValues
        ? stoneTypeValues.map(v => ({ label: v.Name, value: v.Name }))
        : [];

    const optionsMap = {
        'ClientId':      toOptions(clients),
        'Category':      CATEGORY_OPTIONS.map(o => ({ label: o, value: o })),
        'Priority':      PRIORITY_OPTIONS.map(o => ({ label: o, value: o })),
        'Metal.Color':   METAL_COLOR_OPTIONS.map(o => ({ label: o, value: o })),
        'Metal.Quality': METAL_QUALITY_OPTIONS.map(o => ({ label: o, value: o })),
        'StoneType':     stoneTypeOptions,
        'Name':          [],
        'Remarks':       [],
    };

    const model = genAI.getGenerativeModel({
        model: 'gemini-3.6-flash',
        systemInstruction: buildSystemPrompt(clients, stoneTypeValues),
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });

    const result = await model.generateContent(message);

    let parsed;
    try {
        parsed = JSON.parse(result.response.text());
    } catch {
        throw new Error('LLM returned invalid JSON');
    }

    if (isMissing(parsed.Remarks)) {
        parsed.Remarks = message;
    }


        // // Enforce the client-tier priority floor deterministically (only ever escalates).
    // const matchedClient = clients.find(c => String(c._id) === String(parsed.ClientId));
    // if (matchedClient) {
    //     parsed.Priority = highest(parsed.Priority || 'Normal', clientTierPriority(matchedClient));
    // }

    // Attach Status for downstream createEnquiry

    const STATUS_MAP = { coral: 'Coral', cad: 'Cad' };
    parsed.Status = STATUS_MAP[normalizedStatus] || 'Coral';

    const missingFields = buildMissingFields(parsed, requiredFields, optionsMap);

    return { parsed, missingFields };
};