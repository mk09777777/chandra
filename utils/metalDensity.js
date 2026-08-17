// Approximate metal densities (g/cc). The same physical design has a fixed
// volume, so its weight in another metal is oldWeight * (newDensity / oldDensity).
const DENSITY = {
    '10K': 11.42,
    '14K': 13.07,
    '18K': 15.58,
    '22K': 17.80,
    'Silver 925': 10.36,
    'Platinum': 21.45,
};

const BASE_DENSITY = DENSITY['10K'];

function convertMetalWeight(weight, fromQuality, toQuality) {
    const fromDensity = DENSITY[fromQuality];
    const toDensity = DENSITY[toQuality];
    if (!fromDensity || !toDensity || fromQuality === toQuality) return weight;
    return weight * (toDensity / fromDensity);
}

module.exports = { DENSITY, BASE_DENSITY, convertMetalWeight };
