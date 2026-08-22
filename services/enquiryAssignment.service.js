const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const userService = require('./user.service');
const codelistsService = require('./codelists.service');
const notificationService = require('./notifications.service');
const repo = require('../repositories/enquiry.repo');
const { describeAndEmbedImage } = require('./imageDescribe.service');
const { findSimilar } = require('./designSimilarity.service');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const STATUS_TO_ROLE_CODE = {
    'Coral': 'CO',
    'Cad': 'CD'
};

async function resolveRoleId(roleCode) {
    const roles = await codelistsService.getCodelistByName('Roles');
    return roles?.find(r => r.Code === roleCode)?.Id;
}

/**
 * Pick the best designer using a single LLM ranking call.
 * Returns the chosen userId (string) or null if no candidate could be picked.
 */
async function rankDesigner({ designers, referenceTags, referenceDescription, enquiryMeta, workloadMap }) {
    if (!designers || designers.length === 0) return null;
    if (designers.length === 1) return String(designers[0]._id);

    const payload = {
        designers: designers.map(d => ({
            id: String(d._id),
            name: d.name,
            skills: d.skills || '',
            activeEnquiries: workloadMap?.[String(d._id)] ?? 0,
        })),
        referenceTags,
        referenceDescription,
        enquiryMeta,
    };

    const rankSchema = {
        type: SchemaType.OBJECT,
        properties: {
            chosenId: { type: SchemaType.STRING },
            reason: { type: SchemaType.STRING },
        },
        required: ['chosenId', 'reason'],
    };

    const rankModel = genAI.getGenerativeModel({
        model: process.env.GEMINI_RANK_MODEL || 'gemini-3.6-flash',
        systemInstruction: `You are matching a jewellery enquiry to the best designer.
Consider both skill match AND current workload (activeEnquiries).
Prefer a designer with strong matching skills and a lower workload.
IF THE SKILLS ARE EQUALLY MATCHED, prefer the designer with fewer active enquiries, IF NOT THEN THE ONE WITH THE SKILL WILL BE CHOSEN. Do not return the designer with the lowest workload if they have no relevant skills.
Return ONLY a JSON object: { "chosenId": "<designer id>", "reason": "<short reason>" }.
If skills are sparse or absent, pick the designer with the fewest active enquiries.`,
    });

    const res = await rankModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
        generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: rankSchema,
        },
    });

    try {
        const parsed = JSON.parse(res.response.text());
        const chosen = String(parsed.chosenId || '');
        if (designers.some(d => String(d._id) === chosen)) return chosen;
    } catch {
        /* fall through */
    }
    return String(designers[0]._id);
}

/**
 * Auto-assign a Coral or Cad designer based on the reference image descriptions.
 * Best-effort — caller should not let exceptions propagate.
 */
exports.autoAssignDesigner = async ({ enquiry, referenceDescription, referenceTags, detectedGroup }) => {
    const currentStatus = enquiry.StatusHistory?.at(-1)?.Status;
    const roleCode = STATUS_TO_ROLE_CODE[currentStatus];
    if (!roleCode) return null;

    const roleId = await resolveRoleId(roleCode);
    if (!roleId) return null;

    const allDesigners = await userService.getUsersByRoleFull(roleId);
    const groupFiltered = detectedGroup
        ? allDesigners.filter(d => d.group === detectedGroup)
        : [];
    const designers = groupFiltered.length > 0 ? groupFiltered : allDesigners;

    const enquiryMeta = {
        category: enquiry.Category,
        stoneType: enquiry.StoneType,
        metalColor: enquiry.Metal?.Color,
        metalQuality: enquiry.Metal?.Quality,
        remarks: enquiry.Remarks,
        specialRemarks: enquiry.SpecialRemarks,
        priority: enquiry.Priority,
    };

    const designerIds = designers.map(d => String(d._id));
    const workloadMap = await repo.countActiveEnquiriesByDesigners(designerIds);

    const chosenId = await rankDesigner({ designers, referenceTags, referenceDescription, enquiryMeta, workloadMap });
    if (!chosenId) return null;

    const statusEntry = {
        Status: currentStatus,
        Timestamp: new Date(),
        AssignedTo: chosenId,
        AddedBy: 'System (auto-assign)',
        Details: 'Auto-assigned based on reference imagery and designer skills',
    };
    enquiry.StatusHistory.push(statusEntry);
    await repo.updateEnquiry(enquiry._id, { StatusHistory: enquiry.StatusHistory });

    try {
        await notificationService.createAlertsForUsers(
            [chosenId],
            '🎨 New Enquiry Assigned',
            `You've been assigned enquiry "${enquiry.Name}".`,
            'enquiry_assigned',
            `enquiries/${enquiry._id.toString()}`
        );
    } catch (err) {
        console.error('[auto-assign] notification failed:', err);
    }

    return chosenId;
};

/**
 * Orchestrator: runs after enquiry is created with reference images.
 * Best-effort — every block try/catches.
 */
exports.postEnquiryCreateHook = async (enquiry) => {

    const refs = enquiry.ReferenceImages || [];
    const enriched = [];

    if (enriched.length > 0 && !enquiry.Category) {
        const votes = enriched.map(e => e.category).filter(Boolean);
        if (votes.length > 0) {
            const inferred = votes.sort((a, b) =>
                votes.filter(v => v === b).length - votes.filter(v => v === a).length
            )[0];
            try {
                await repo.updateEnquiry(enquiry._id, { Category: inferred });
                enquiry.Category = inferred;
            } catch (err) {
                console.error('[post-create] category inference update failed:', err);
            }
        }
    }

    try {
        const combinedDescription = enriched.map(e => e.description).join('\n\n');
        const combinedTags = [...new Set(enriched.flatMap(e => e.tags))];

        const VALID_GROUPS = ['Bridal', 'Hip-hop', 'Cuban'];
        const GROUP_KEYWORDS = {
            'Bridal':  ['bridal', 'engagement', 'wedding', 'solitaire', 'eternity', 'romantic', 'floral'],
            'Hip-hop': ['hip hop', 'hip-hop', 'hiphop', 'iced', 'bling', 'statement', 'bold'],
            'Cuban':   ['cuban', 'link', 'chain', 'thick', 'street'],
        };
        const enquiryText = [enquiry.Category, enquiry.Remarks, enquiry.SpecialRemarks]
            .filter(Boolean).join(' ').toLowerCase();

        const groupVotes = enriched.map(e => e.group).filter(g => VALID_GROUPS.includes(g));
        for (const [group, keywords] of Object.entries(GROUP_KEYWORDS)) {
            if (keywords.some(kw => enquiryText.includes(kw))) groupVotes.push(group);
        }

        const detectedGroup = groupVotes.length > 0
            ? groupVotes.sort((a, b) =>
                groupVotes.filter(v => v === b).length - groupVotes.filter(v => v === a).length
              )[0]
            : null;

        await exports.autoAssignDesigner({
            enquiry,
            referenceDescription: combinedDescription,
            referenceTags: combinedTags,
            detectedGroup,
        });
    } catch (err) {
        console.error('[post-create] autoAssignDesigner failed:', err);
    }

    if (enriched.length === 0) return;
    try {
        const seen = new Map();
        for (const e of enriched) {
            const matches = await findSimilar({
                embedding: e.embedding,
                limit: 5,
                excludeEnquiryId: enquiry._id,
            });
            for (const m of matches) {
                const key = String(m._id);
                const prev = seen.get(key);
                if (!prev || m.score > prev.score) seen.set(key, m);
            }
        }
        const top = Array.from(seen.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(m => ({ EnquiryId: m.EnquiryId, Key: m.Key, Score: m.score }));

        if (top.length > 0) {
            await repo.updateEnquiry(enquiry._id, { SimilarDesigns: top });
        }
    } catch (err) {
        console.error('[post-create] findSimilar failed:', err);
    }
};
