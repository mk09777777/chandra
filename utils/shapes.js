// Canonical short code per stone shape; every known synonym (code or word) maps to it.
// Keys are de-spaced + uppercased before lookup.
const SHAPE_SYNONYMS = {
    RD: 'RD', ROUND: 'RD', RND: 'RD', RB: 'RD', BR: 'RD',
    OV: 'OV', OVAL: 'OV',
    EM: 'EM', EMERALD: 'EM', EMRLD: 'EM', EC: 'EM',
    PS: 'PS', PE: 'PS', PEAR: 'PS', PEARSHAPE: 'PS',
    PR: 'PR', PRINCESS: 'PR', PRIN: 'PR',
    CU: 'CU', CUSHION: 'CU', CUSH: 'CU',
    MQ: 'MQ', MARQUISE: 'MQ', MARQ: 'MQ',
    RA: 'RA', RADIANT: 'RA', RAD: 'RA',
    AS: 'AS', ASSCHER: 'AS', ASCHER: 'AS',
    HT: 'HT', HEART: 'HT', HRT: 'HT',
    BG: 'BG', BAGUETTE: 'BG', BAG: 'BG',
    TB: 'TB', TAPEREDBAGUETTE: 'TB',
    TR: 'TR', TRILLION: 'TR', TRILLIANT: 'TR', TRI: 'TR',
    HM: 'HM', HALFMOON: 'HM',
    SQ: 'SQ', SQUARE: 'SQ',
};

const ROUND_CODE = 'RD';

// Canonicalize a shape string to its short code. Unknown shapes fall back to the
// de-spaced uppercase form, so both sides of a comparison are treated identically.
function normalizeShape(s) {
    if (!s) return '';
    const key = String(s).trim().toUpperCase().replace(/[\s._-]+/g, '');
    return SHAPE_SYNONYMS[key] || key;
}

const isRoundShape = (s) => normalizeShape(s) === ROUND_CODE;

module.exports = { normalizeShape, isRoundShape, ROUND_CODE, SHAPE_SYNONYMS };
