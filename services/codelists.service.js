const repo = require('../repositories/codelists.repo');

exports.getCodelistByName = async (name) => {
    try {
        return await repo.getCodelistByName(name);
    } catch (error) {
        console.error("Error fetching codelist by name:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// Case-insensitively canonicalize stone-type values against the StoneTypes codelist.
// Unmatched values are kept as sent (accept-anything); the result is de-duped.
exports.canonicalizeStoneTypes = async (values) => {
    if (!Array.isArray(values)) return [];
    const list = (await exports.getCodelistByName('StoneTypes')) || [];
    const map = new Map(list.map(v => [String(v.Name).toLowerCase(), v.Name]));
    const out = [];
    for (const v of values) {
        const raw = String(v ?? '').trim();
        if (!raw) continue;
        const canon = map.get(raw.toLowerCase()) || raw;
        if (!out.includes(canon)) out.push(canon);
    }
    return out;
};