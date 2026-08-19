
const DENSITY = {
    '3K': 9.60,
    '9K': 11.20,
    '10K': 11.42,
    '14K': 13.07,
    '18K': 15.58,
    '22K': 17.80,
    '24K': 19.32,
    'Silver 925': 10.36,
    'Platinum': 21.45,
};

const BASE_DENSITY = DENSITY['10K'];

const DENSITY_BY_KEY = Object.fromEntries(
    Object.entries(DENSITY).map(([quality, density]) => [quality.trim().toLowerCase(), density])
);

function normalizeQuality(quality) {
    return String(quality ?? '').trim().toLowerCase();
}

function densityFor(quality) {
    return DENSITY_BY_KEY[normalizeQuality(quality)] ?? null;
}

// Same quality in and out means the weight already belongs to it — leave it alone.
function convertMetalWeight(weight, fromQuality, toQuality) {
    console.log('convertMetalWeight', weight, fromQuality, toQuality);
    if (normalizeQuality(fromQuality) === normalizeQuality(toQuality)) return weight;
    else if(fromQuality && toQuality===null) return weight;

    const fromDensity = densityFor(fromQuality);
    const toDensity = densityFor(toQuality);
    if (!fromDensity || !toDensity) return weight;
    if (fromDensity === toDensity) return weight;

    return weight * (toDensity / fromDensity);
}

module.exports = { DENSITY, BASE_DENSITY, densityFor, convertMetalWeight };
