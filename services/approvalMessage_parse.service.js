const { GoogleGenerativeAI } = require('@google/generative-ai');
const codelistsService = require('./codelists.service');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SPEC_FIELDS = [
    'decision',
    'reason',
    'deliveryDate',
    'priority',
    'metal',
    'colour',
    'stoneType',
    'diamondQuality',
    'centreStone',
    'colourStone',
    'budget',
    'weightRange',
    'maxWeight',
    'size',
    'designChange',
    'findings',
    'engraving',
    'finish',
    'specialRemarks',
];

const CHECKLIST_KEYS = [
    'Engraving',
    'SizeLength',
    'SizeRingSize',
    'DimensionsThickness',
    'DeliveryDate',
    'EnamelPaintwork',
    'RhodiumInstructions',
    'Components',
    'Findings',
];

const DECISIONS = ['Approved', 'Approved with date', 'Redo'];
const REASONS = ['PRICE', 'DESIGN', 'STONE', 'TIMING', 'OTHER'];
const PRIORITY = ['Super High', 'High', 'Medium', 'Low'];
const UNSPEC = 'Not specified — client did not say';
const STONES = ['Type 1', 'Type 2', 'Type 3', 'Natural regular', 'Natural higher', 'Natural lower', 'Natural', 'Lab-grown'];
const STONE_ALIAS = [
    [/\b(type|t)\s*-?\s*1\b/i, 'Type 1'],
    [/\b(type|t)\s*-?\s*2\b/i, 'Type 2'],
    [/\b(type|t)\s*-?\s*3\b/i, 'Type 3'],
    [/natural\s*(higher|high|better|premium|up)/i, 'Natural higher'],
    [/natural\s*(lower|low|cheaper|down)/i, 'Natural lower'],
    [/natural\s*(regular|normal|standard|reg)/i, 'Natural regular'],
    [/\b(cvd|lab[\s-]*grown|lab)\b/i, 'Lab-grown'],
    [/\bnatural\b/i, 'Natural'],
];
const SKIP_ANSWERS = ['skip', "don't know", 'dont know', 'do not know', 'no idea', 'not sure', 'unknown', 'n/a', 'na', 'none', 'nothing'];

const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        decision: { type: 'STRING', nullable: true },
        reason: { type: 'STRING', nullable: true },
        deliveryDate: { type: 'STRING', nullable: true },
        priority: { type: 'STRING', nullable: true },
        metal: { type: 'STRING', nullable: true },
        colour: { type: 'STRING', nullable: true },
        stoneType: { type: 'STRING', nullable: true },
        diamondQuality: { type: 'STRING', nullable: true },
        centreStone: { type: 'STRING', nullable: true },
        colourStone: { type: 'STRING', nullable: true },
        budget: { type: 'STRING', nullable: true },
        weightRange: { type: 'STRING', nullable: true },
        maxWeight: { type: 'STRING', nullable: true },
        size: { type: 'STRING', nullable: true },
        designChange: { type: 'STRING', nullable: true },
        findings: { type: 'STRING', nullable: true },
        engraving: { type: 'STRING', nullable: true },
        finish: { type: 'STRING', nullable: true },
        specialRemarks: { type: 'STRING', nullable: true },
        checklist: {
            type: 'OBJECT',
            properties: Object.fromEntries(CHECKLIST_KEYS.map(k => [k, { type: 'STRING', nullable: true }])),
            propertyOrdering: CHECKLIST_KEYS,
        },
        questions: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    field: { type: 'STRING' },
                    ask: { type: 'STRING' },
                },
                required: ['field', 'ask'],
                propertyOrdering: ['field', 'ask'],
            },
        },
    },
    required: ['decision'],
    propertyOrdering: [...SPEC_FIELDS, 'checklist', 'questions'],
};

function buildSystemPrompt(stoneTypes, mode) {
    const currentDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const currentWeekday = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
    const plusDays = (base, n) => {
        const [y, m, d] = base.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d + n)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    };
    const ex2d = plusDays(currentDate, 2);
    const ex5d = plusDays(currentDate, 5);

    const stoneTypeValues = Array.isArray(stoneTypes) ? stoneTypes.map(v => String(v.Name).trim()).filter(Boolean) : [];
    const systemStoneList = stoneTypeValues.length ? stoneTypeValues.join(' · ') : STONES.join(' · ');

    const modeBlock = mode === 'reject'
        ? `MODE — REDO. The handler has already decided this — never question it, never ask about it.
The piece goes back to be done again. Set "decision" to exactly "Redo". Set "reason" to exactly one of
PRICE, DESIGN, STONE, TIMING, OTHER. Everything the client wants different goes into the key it belongs to,
so the designer can act on it — put anything that does not fit a key into "specialRemarks".`
        : `MODE — APPROVED. The handler has already read the message and pressed Approve — the decision is settled.
Never question it and never ask whether it is approved. Set "decision" to "Approved", or "Approved with date"
if he gave any date or deadline.`;

    return `You read a jewellery client's reply to a drawing we sent, and turn it into a short instruction record.
You are not matching keywords. You are working out what the client actually wants changed, and what the workshop
must not get wrong.

TODAY IS ${currentDate} (${currentWeekday}).

${modeBlock}

═══ HOW TO THINK ═══
1. What is he changing from the quotation above? Only those things get a value.
2. What is he keeping? Those keys stay null. "keep same", "rest same", "no change" means null.
3. Does a change drag another one with it? A budget cut changes the weight band and the CAD ceiling.
   Work that out from the quoted numbers above — never invent a figure that has no basis in them.
4. Is there anything the workshop would get wrong if it was not written down? That goes in specialRemarks.

Reason from these principles. They are not keyword lists — a client who says something none of the wording
below anticipates still lands in the key that carries his meaning. Hinglish is normal: kam/kum karo = reduce ·
thoda = a little · same rakho = keep the same · chahiye = wants · jaldi = urgent · nahi/mat = not ·
badhao = increase · theek hai = fine.

═══ TIME — deliveryDate AND priority ═══
There is ONE date key. In hand, ship by, delivery, deadline, "chahiye by" — every date he gives goes to
deliveryDate. Two dates → take the one the piece must be FINISHED by. No date → null; never invent one.
THE VALUE IS THE DATE ALONE — "20 Sep", day and three-letter month. Strip every surrounding word (by, in hand,
needs it, urgent, before, latest, client wants). No year unless he wrote one, then keep his.
Resolve anything relative against TODAY and write the resulting date, never the phrase:
a bare day → its next occurrence · a weekday → its date · a day-count ("in 2 days", "2 din me", "15 days me")
→ TODAY + N, so "in 2 days" → "${ex2d}" and "in 5 days" → "${ex5d}". A day-count is a real deadline, so it
also sets priority "High".

priority IS A FIXED LADDER — write exactly one of these, never his own phrase:
  "Super High" — drop everything (urgent, jaldi chahiye, asap, rush, this one first, client is waiting)
  "High"       — a real deadline with no written date (before diwali, for a wedding, shipment on the 10th,
                 he leaves on the 22nd) or any calculable day-count
  "Medium"     — he named a date and showed no urgency. Only alongside a deliveryDate.
  "Low"        — he took the pressure off (no hurry, koi jaldi nahi, whenever, take your time)
No sense of time anywhere → priority null. Do not default it. A date plus a hurry word fills both keys.
NEVER ASK A QUESTION ABOUT TIME — every hurry lands in one of these two keys.

═══ colour ═══
A colour change touches colour and NOTHING else — no price, no weight, no maxWeight, and no mention in
specialRemarks. The value is the metal colour alone, with "gold" after a single colour so it cannot read as a
stone or an enamel: "White gold" · "Yellow gold" · "Rose gold" · "Two-tone — rose and white".
NEVER record which part gets which colour — no back, front, shank, halo, sides. Two colours are named and that
is all ("rose at the back, white in the front" → "Two-tone — rose and white"), and which face is which is never
a question because it is never stored. Strip all/full/instead of/changed from and anything about the old colour.

═══ metal, stone type and diamond quality ═══
metal is the karat with a T — "14K", "14kt", "14 k" all → "14KT". Platinum stays "Platinum".
On a metal change fill metal ONLY: leave weightRange and maxWeight null and never ask about them, because the
system recomputes the gram band itself from the quoted weight. You never do that arithmetic.
The stones do not move with the metal — carat, count and size stay exactly as quoted.

stoneType is one of a known list: "Type 1" · "Type 2" · "Type 3" (lab tiers) · "Natural regular" ·
"Natural higher" · "Natural lower" (natural tiers) · "Natural" · "Lab-grown" (when he names no tier).
The system's own stone list is: ${systemStoneList}
Map his wording onto that list by meaning — a tier number in any form is that Type, "high/better/premium"
is Natural higher, "low/cheaper" is Natural lower, "normal/standard" is Natural regular, and CVD or lab grown
is Lab-grown.
A TIER IS NOT A CLARITY. Tiers go in stoneType; diamondQuality is only VVS / VS / VS1 / VS2 / SI and the like.
One message can carry both. Changing tier or natural↔lab moves the price only — no gram, carat or design
change, and no question. Never quote a price back to the client; the recalculation stays internal.

═══ budget reduction ═══
When he asks for it cheaper without naming a figure, budget is "Reduce by $300"; if he names one, use his.
weightRange is the quoted band moved down by about 5 g, and maxWeight is the BOTTOM of that new band — the only
weight figure the CAD designer ever sees, and he is never told the original quote.
designChange is "Outer dimensions unchanged — hollow the solid, grill the back, thin the metal."
specialRemarks must carry "Size and outer dimensions must not change." This is a hard rule.

═══ designChange, findings, engraving — and the MIRROR RULE ═══
designChange covers bale, halo, centre shape, setting, layout, thickness, size and length, in plain words.
A ring size is written "Ring size 7"; a length is written "18 inch".

designChange IS THE LAST RESORT, NEVER A SUMMARY. It holds only what no dedicated key can carry. Before you
write it, check whether the thing he asked for already belongs to colourStone, centreStone, stoneType,
diamondQuality, metal, colour, finish, size, engraving or findings — if it does, it goes THERE and designChange
stays null. Never restate in designChange something another key already holds, and never use it as a sentence
describing the whole request. A coloured centre stone is colourStone alone; a red enamel is finish alone; a ring
size is size alone. designChange earns a value only when the geometry itself moves — a halo added or removed, a
bale resized, a setting style changed, a band thinned, a layout redrawn.
findings covers posts, backs, locks, clasps, chain — in his own words, nothing appended, never a house default.
Too vague to act on ("change the findings") → leave it null and ask which.

finish covers every surface treatment: enamel, paint, colour fill, meena, rhodium (plain or black), and the
polish itself (mirror, matte, satin, antique). Name the treatment, the colour and where it goes — "Red enamel
on the stone setting borders", "Black rhodium on the shank", "Matte finish on the shank". A colour ON THE PIECE
is a finish, not a metal colour: colour belongs to the metal, finish belongs to what is applied on top of it.
If he asks for a colour treatment but names no colour, or for rhodium without saying plain or black, leave
finish null and ask.

MIRROR RULE: whenever designChange, findings or engraving is filled, specialRemarks MUST also be written, as a
plain order to the bench — "Full eternity setting" → "Setting is full eternity."; "Threaded post" → "Post is
threaded." Two of the three filled → one specialRemarks holding both, separated by a full stop.

specialRemarks also carries anything the workshop could get wrong even when nothing else changed: stone
requirements, colour matching, finishing, physical constraints, hallmark and stamping. Write it as an
instruction to the bench, not as a quote of the client. NOTHING EXTERNAL belongs there — no dates, priority,
budget, colour, price, client mood or "he says".

═══ THE QUOTATION LINE IS NOT AN INSTRUCTION ═══
Our own quotation is very often pasted into the group right above or inside the approval. It looks like this:

    Approx 125-150/- 10Kt gold and Natural
    Approx 2600-2625/- 15.95 carats CVD, 50-55 grams Silver

Any line carrying "approx", a "/-" price, a price range, or a straight recital of metal + carats + grams is
OUR QUOTE BEING FORWARDED BACK. It is the baseline, not a change. IGNORE IT COMPLETELY.
· never put its price or its range into budget
· never put its grams into weightRange or maxWeight
· never put its metal, carats or stone type into metal / stoneType / centreStone
· never repeat it in specialRemarks
A message that is only a quotation line plus an approval word is a plain approval — decision alone.

Then read WHAT IS LEFT after the quotation line. Real instructions sit alongside it and still count:
    "Approx 2600-2625/- 15.95 carats CVD, 50-55 grams Silver. All white. Need by Sept 1st"
      → the quote part is ignored; "All white" is a colour; "Need by Sept 1st" is the date.

═══ HARD RULES ═══
· Only include a key if the client changed that thing. Everything else is null. A plain "Approved." returns decision
  alone and nothing more.
· COLOUR STONES ARE THE EASIEST THING TO LOSE. If he mentions ruby, emerald, sapphire, black stone, synthetic or
  any coloured stone, it MUST go in colourStone, and a plain note in specialRemarks — "Note: synthetic ruby in the
  eyes." Never explain where it came from. Never write "this is not on the quotation", never mention the quotation,
  the code, the price or any internal paperwork in any value. specialRemarks reads like a note to the bench.
· ANY LETTERS ON THE PIECE ARE ENGRAVING. Initials, a name, a word, a date, a number, a monogram, a hallmark, a
  stamp, a logo — "JU on the back", "put SK inside", "his name on the shank", "write 2026", "our mark on the bail".
  All of it goes in "engraving". NEVER in designChange, NEVER only in specialRemarks. Copy the characters exactly as
  he wrote them, in quotes, and say where they go: "Engrave 'JU' on the back".
  If he does not say where, still record the letters and ask where they go.
· ENGRAVING never blocks anything. If he asks for engraving but gives no text, set engraving to
  "Engraving required — text to follow, added at the final cut" and ask what the text should be. Never leave it null.
· NO EXTRA WORDS IN ANY VALUE. Never append "", never write "client wants", "please",
  "as requested", "instead of X", or anything about what it used to be. The value is the instruction itself.
  "threaded post please" → "Threaded post". "make full eternity" → "Full eternity setting".
· "X instead of Y" and "not Y, X" mean X is the target. Take the left side.
· Numbers with no unit ("make it 35") are ambiguous — do not guess. Leave the key null and ask.
· Never write a price for the client. Price changes stay internal.
· NEVER invent a value. If the client asked for something but did not say what, the key stays null and you ask a
  question for it. A guessed value is worse than an empty one.
· Hinglish is normal. kam/kum karo = reduce · thoda = a little · same rakho = keep the same · chahiye = wants ·
  jaldi = urgent · nahi/mat = not · badhao = increase · theek hai = fine.

═══ THE ENQUIRY CHECKLIST ═══
There is a second, separate object called "checklist". It is the checklist the workshop opens the enquiry with, and
it has exactly these nine keys. Fill a key ONLY if the client actually mentioned that thing in this message.
Anything he did not mention stays null — the system writes "NA" into it.

Engraving            any letters on the piece — initials, name, word, date, monogram, hallmark, stamp,
                     logo — and where they go. Keep the characters exactly as the client wrote them.
SizeLength           a length — chain, bracelet, necklace ("22 inch", "18 in")
SizeRingSize         a ring size ("size 7", "US 6.5") — never a length, never grams
DimensionsThickness  an outer measurement or thickness — mm of a bale, band width, how thick or thin
DeliveryDate         the date it must be in hand, as "20 Sep" and nothing else
EnamelPaintwork      enamel, paint, colour fill, meena
RhodiumInstructions  rhodium, black rhodium, plating instructions, "no rhodium"
Components           parts that make up the piece — chain, clasp, extra charm, jump ring, back plate
Findings             post type, backs, locks, clasps

FINDINGS VOCABULARY — when the client names a finding, return that exact finding. The house forms are:
    Chain - Light · Chain - Medium · Chain - Heavy · Nutpost · Lock - Handmade · Lock - Ready Made
Findings is a SINGLE field. If he names one, return it; if he names none, leave it null.

HOW THE CHECKLIST IS READ — the same discipline the enquiry is opened with:
· Extract only what the client explicitly stated. Do not infer, assume, calculate or guess.
· Preserve the client's own wording wherever you can. Write a short instruction, not a sentence.
· A key he did not mention stays null — the system writes "NA" into it.
· If he gives more than one value for one key, combine them into a single string.

The checklist is not a copy of the keys above — it is the workshop's own list, and one message fills both where
they overlap: "size 7" fills "size" AND checklist.SizeRingSize; "22 inch chain" fills checklist.SizeLength AND
checklist.Components; an engraving fills "engraving" AND checklist.Engraving with the characters exactly as he
wrote them; a finding fills "findings" AND checklist.Findings; a date fills "deliveryDate" AND
checklist.DeliveryDate as the same "20 Sep" value; enamel, paint, colour fill or meena fills "finish" AND
checklist.EnamelPaintwork; rhodium fills "finish" AND checklist.RhodiumInstructions; a stated thickness, band
width or bale measurement fills checklist.DimensionsThickness even when the change itself sits in designChange.

A design instruction never lands in designChange ALONE when part of it belongs to a checklist key. Split it:
the shape, layout or setting stays in designChange, and the treatment, measurement or component inside it also
fills the checklist key that carries it.

═══ questions — THE MISSING VALUES ═══
Whenever the client clearly asked for something but did NOT give the value it needs, leave that key null and put a
question in "questions". Each question is { "field": <one of the keys above>, "ask": <one short plain sentence> }.

The test is always the same: he asked for a change, but the one detail needed to carry it out is absent —
a reduction with no figure, a resize with no measurement, a finding or colour or engraving text left unnamed,
a rhodium type unstated, a number with no unit, a phrase that reads two ways, or one message that seems to
cover more than one piece. Ask on the key that detail belongs to.

NEVER ask about "decision" or "reason" — the handler settled that before you saw the message.
NEVER ask about time; hurry always resolves into deliveryDate or priority.

KEEP EVERY QUESTION TO THREE OR FOUR WORDS — a short label with a question mark, nothing more. The field name
is already shown beside it, so never repeat it or explain why you are asking: "Budget figure?" ·
"Engraving text?" · "Grams or ring size?" · "Which initials, where?"
Never a sentence. Never "he said" or "the client". Never more than four. Empty list when nothing is missing.

═══ EXAMPLES — only where the exact wording is a convention you cannot derive ═══
"ok, need it in 2 days"
→ {"decision":"Approved with date","deliveryDate":"${ex2d}","priority":"High","checklist":{"DeliveryDate":"${ex2d}"}}

"thoda budget kam karo, size same rakho"
→ {"decision":"Approved","designChange":"Outer dimensions unchanged — hollow the solid, grill the back, thin the metal","specialRemarks":"Size and outer dimensions must not change.","questions":[{"field":"budget","ask":"Budget figure?"}]}

"approved, engrave inside band"
→ {"decision":"Approved","engraving":"Engraving required — text to follow, added at the final cut","questions":[{"field":"engraving","ask":"Engraving text?"}]}

"approved, ruby in the eyes"
→ {"decision":"Approved","colourStone":"Synthetic ruby — in the eyes","specialRemarks":"Note: synthetic ruby in the eyes."}

"Approx 2600-2625/- 15.95 carats CVD, 50-55 grams Silver. All white. Need by Sept 1st"
→ {"decision":"Approved with date","colour":"White gold","deliveryDate":"1 Sep","checklist":{"DeliveryDate":"1 Sep"}}

"too expensive for them right now"   (redo mode)
→ {"decision":"Redo","reason":"PRICE","specialRemarks":"Client says the price is too high for them at the moment."}

Return the JSON object only.`;
}

function buildEnquiryText({ enquiry, mode }) {
    const e = enquiry || {};
    const q = e.quote || {};
    return [
        'PIECE',
        `  name: ${e.name || ''}`,
        `  client: ${e.client || ''}`,
        `  style: ${e.style || ''}`,
        `  line: ${e.line || ''}`,
        'QUOTED AS',
        `  metal: ${q.metal || ''}`,
        `  colour: ${q.colour || ''}`,
        `  stoneType: ${q.stoneType || ''}`,
        `  carat: ${q.carat || ''}`,
        `  weight: ${q.weight || ''}`,
        `  price: ${q.price || ''}`,
        '',
        `BUTTON PRESSED: ${mode === 'reject' ? 'reject (redo)' : 'approve'}`,
    ].join('\n');
}

function buildFollowUpText({ message, previous, answers }) {
    const answered = (Array.isArray(answers) ? answers : []).filter(a => a && a.field && a.answer && String(a.answer).trim());
    if (!answered.length) return '';
    return [
        '',
        'THE CLIENT WROTE:',
        `"${String(message || '').trim()}"`,
        '',
        'YOU ALREADY READ IT AS:',
        JSON.stringify(previous && typeof previous === 'object' ? previous : {}, null, 2),
        '',
        'THEN YOU ASKED, AND THE HANDLER ANSWERED:',
        ...answered.map(a => `· ${a.ask || a.field}\n  ANSWER: ${String(a.answer).trim()}`),
        '',
        'Now read the whole thing again — the message plus those answers — and return the corrected record.',
        'Put each answer into the key it belongs to, written the way the workshop needs to read it, not copied word for word.',
        'An answer of "don\'t know", "skip", "no idea" or similar means the client never said — set that key to exactly ' +
            `"${UNSPEC}" so the designer can see the change was asked for, and drop the question.`,
        'Never drop the change itself just because the detail is missing.',
        'Keep everything you already had right. Only ask again if an answer itself left something missing.',
    ].join('\n');
}

function norm(value, list) {
    const v = String(value || '').trim();
    if (!v) return undefined;
    return list.find(x => x.toLowerCase() === v.toLowerCase()) || undefined;
}

function normStone(value) {
    const v = String(value || '').trim();
    if (!v) return v;
    const exact = STONES.find(x => x.toLowerCase() === v.toLowerCase());
    if (exact) return exact;
    for (const [re, out] of STONE_ALIAS) if (re.test(v)) return out;
    return v;
}

function normalizeMetal(value) {
    const v = String(value || '').trim();
    const m = v.match(/^(\d{1,2})\s*k/i);
    if (m) return `${m[1]}KT`;
    return v;
}

function isSkipAnswer(value) {
    const v = String(value || '').trim().toLowerCase().replace(/[.!?]+$/, '').trim();
    return SKIP_ANSWERS.includes(v);
}

const kt = t => { const m = String(t || '').match(/(\d{1,2})\s*k/i); return m ? +m[1] : null };
const g1 = n => (Math.round(n * 10) / 10).toString().replace(/\.0$/, '');

function scaleWeight(enquiry, record) {
    const q = (enquiry && enquiry.quote) || {};
    const K1 = kt(q.metal), K2 = kt(record.metal);
    if (!K1 || !K2 || K1 === K2) return;
    const band = String(q.weight || '').match(/([\d.]+)\s*[–—\-to]+\s*([\d.]+)/);
    if (!band) return;
    const lo = +band[1] * K2 / K1, hi = +band[2] * K2 / K1;
    if (!isFinite(lo) || !isFinite(hi)) return;
    record.weightRange = g1(lo) + '–' + g1(hi) + ' g';
    record.maxWeight = g1(hi) + ' g';
}

function cleanSpec(parsed, mode) {
    const out = {};
    if (parsed && typeof parsed === 'object') {
        for (const key of SPEC_FIELDS) {
            const v = parsed[key];
            if (v != null && String(v).trim() !== '') out[key] = String(v).trim();
        }
    }
    if (mode === 'reject') {
        out.decision = 'Redo';
    } else {
        out.decision = /^approved/i.test(out.decision || '') ? (norm(out.decision, DECISIONS) || 'Approved') : 'Approved';
    }
    if (out.reason !== undefined) {
        const r = norm(out.reason, REASONS);
        if (r) out.reason = r; else delete out.reason;
        if (out.decision !== 'Redo') delete out.reason;
    }
    if (out.priority !== undefined) {
        const p = norm(out.priority, PRIORITY);
        if (p) out.priority = p; else delete out.priority;
    }
    return out;
}

function cleanChecklist(parsed) {
    const src = parsed && parsed.checklist && typeof parsed.checklist === 'object' ? parsed.checklist : {};
    const out = {};
    for (const key of CHECKLIST_KEYS) {
        const v = src[key];
        out[key] = v != null && String(v).trim() !== '' && String(v).trim().toUpperCase() !== 'NA'
            ? String(v).trim()
            : 'NA';
    }
    out.GeneratedAt = new Date();
    return out;
}

function cleanQuestions(parsed) {
    const qs = Array.isArray(parsed && parsed.questions) ? parsed.questions : [];
    const seen = new Set();
    const out = [];
    for (const q of qs) {
        if (out.length >= 4) break;
        const field = q && q.field;
        const ask = q && q.ask && String(q.ask).trim();
        if (!field || !ask) continue;
        if (!SPEC_FIELDS.includes(field)) continue;
        if (field === 'decision' || field === 'reason') continue;
        if (seen.has(field)) continue;
        seen.add(field);
        out.push({ field, ask });
    }
    return out;
}

function mergePrevious(previous, mode) {
    const base = {};
    if (previous && typeof previous === 'object') {
        for (const key of SPEC_FIELDS) {
            const v = previous[key];
            if (v != null && String(v).trim() !== '') base[key] = String(v).trim();
        }
    }
    return base;
}

function applyAnswers(record, answers) {
    if (!Array.isArray(answers)) return record;
    for (const a of answers) {
        const field = a && a.field;
        const value = a && a.answer && String(a.answer).trim();
        if (!field || !SPEC_FIELDS.includes(field) || !value) continue;
        record[field] = value;
    }
    return record;
}

async function callGemini({ enquiry, mode, message, previous, answers, stoneTypes }) {
    const followUp = buildFollowUpText({ message, previous, answers });
    const parts = [
        buildEnquiryText({ enquiry, mode }),
        '',
        `CLIENT REPLY\n${String(message || '').trim()}`,
        followUp,
    ].filter(Boolean);

    const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
        systemInstruction: buildSystemPrompt(stoneTypes, mode),
        generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
        },
    });

    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: parts.join('\n') }] }],
    });

    const raw = result.response.text();
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error('Gemini returned invalid JSON');
    }
    return parsed;
}

exports.parseApprovalMessage = async ({ enquiry, mode, message, previous, answers } = {}) => {
    const text = String(message || '').trim();
    if (!text) throw new Error('message is required');

    const stoneTypes = (await codelistsService.getCodelistByName('StoneTypes')) || [];
    const parsed = await callGemini({ enquiry, mode, message: text, previous, answers, stoneTypes });

    const hasAnswers = Array.isArray(answers) && answers.some(a => a && a.field && a.answer && String(a.answer).trim());
    let record = hasAnswers ? mergePrevious(previous, mode) : {};
    Object.assign(record, cleanSpec(parsed, mode));
    if (hasAnswers) {
        applyAnswers(record, answers);
        for (const a of answers) {
            const field = a && a.field;
            if (field && SPEC_FIELDS.includes(field) && isSkipAnswer(a.answer)) record[field] = UNSPEC;
        }
    }

    if (record.metal !== undefined) {
        record.metal = normalizeMetal(record.metal);
        scaleWeight(enquiry, record);
    }

    if (record.stoneType !== undefined) {
        record.stoneType = normStone(record.stoneType);
        const canon = (await codelistsService.canonicalizeStoneTypes([record.stoneType]))[0];
        if (canon) record.stoneType = canon;
    }

    return {
        ...record,
        checklist: cleanChecklist(parsed),
        questions: cleanQuestions(parsed),
    };
};