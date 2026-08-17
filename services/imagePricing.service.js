const sharp = require('sharp');
const { calculatePricing, loadPricingRefs } = require('./pricing.service');
const { preprocessImage, extractTableWithTesseract, reconcileWithGemini, validateAndRetryRows } = require('./ocr.service');
const { createConcurrencyLimiter } = require('../utils/concurrency');

const MAX_CONCURRENT_PRICING = 3;
const runPricingLimited = createConcurrencyLimiter(MAX_CONCURRENT_PRICING);

// Crop the image to the region the user marked on the frontend, given as fractions (0..1)
// of the original image. Cropping happens here at full resolution so the device never has to
// (on-device cropping degraded the image on iOS). Returns the original buffer when there is
// no crop or it covers the whole image.
async function cropByFractions(buffer, crop) {
    if (!crop) {
        console.log('[crop][service] no crop → using whole image');
        return buffer;
    }
    const { x = 0, y = 0, w = 1, h = 1 } = crop;
    if (!(x > 0) && !(y > 0) && !(w < 1) && !(h < 1)) {
        console.log('[crop][service] crop covers whole image → skipping', crop);
        return buffer;
    }
    const meta = await sharp(buffer).rotate().metadata(); // .rotate() applies EXIF orientation
    const W = meta.width, H = meta.height;
    if (!W || !H) {
        console.log('[crop][service] could not read dimensions → using whole image', { W, H });
        return buffer;
    }
    const left = Math.max(0, Math.min(W - 1, Math.round(x * W)));
    const top = Math.max(0, Math.min(H - 1, Math.round(y * H)));
    const width = Math.max(1, Math.min(W - left, Math.round(w * W)));
    const height = Math.max(1, Math.min(H - top, Math.round(h * H)));
    console.log('[crop][service] cropping', { fractions: crop, imageSize: { W, H }, extract: { left, top, width, height } });
    const out = await sharp(buffer).rotate().extract({ left, top, width, height }).toBuffer();
    console.log('[crop][service] cropped buffer bytes', out.length);
    return out;
}

async function extractPricingDataFromImage(imageBuffer, mimeType) {
    let preprocessed = await preprocessImage(imageBuffer);
    imageBuffer = null;

    const ocrText = await extractTableWithTesseract(preprocessed);
    const preprocessedBase64 = preprocessed.toString('base64');
    preprocessed = null;
    console.log(`[ocr] Raw OCR text:\n${ocrText}`);

    const finalData = await reconcileWithGemini(preprocessedBase64, ocrText, mimeType);
    finalData.Stones = finalData.Stones || [];

    finalData.Stones = await validateAndRetryRows(finalData.Stones, preprocessedBase64, mimeType);

    return finalData;
}

exports.extractPricingDataFromImage = extractPricingDataFromImage;

function validateExtracted(data) {
    if (!data || typeof data !== 'object') throw new Error('LLM returned invalid data');
    if (!Array.isArray(data.Stones)) throw new Error('LLM response missing Stones array');
    if (!data.Metal || typeof data.Metal !== 'object') throw new Error('LLM response missing Metal object');
    return data;
}

exports.extractAndPrice = runPricingLimited(async ({ imageBuffer, mimeType, clientId, stoneTypes, quantity, metalQualities, crop }) => {
    let workingBuffer = await cropByFractions(imageBuffer, crop);
    imageBuffer = null;
    const extracted = validateExtracted(await extractPricingDataFromImage(workingBuffer, mimeType));
    workingBuffer = null;

    const types = (Array.isArray(stoneTypes) && stoneTypes.length)
        ? [...new Set(stoneTypes.filter(Boolean))]
        : [''];

    const qualities = (Array.isArray(metalQualities) && metalQualities.length)
        ? [...new Set(metalQualities.filter(Boolean))]
        : [extracted.Metal?.Quality || null];

    const baseDetails = {
        Quantity: quantity || 1,
        TotalPieces: extracted.TotalPieces || 0,
    };

    const refs = await loadPricingRefs(clientId);

    const pricing = [];
    for (const quality of qualities) {
        for (const type of types) {
            pricing.push(await calculatePricing({
                ...baseDetails,
                Metal: {
                    Weight: extracted.Metal?.Weight || null,
                    Quality: extracted.Metal?.Quality || null,
                },
                Stones: (extracted.Stones || []).map(stone => ({
                    ...stone,
                    Type: type,
                    Markup: 0,
                })),
            }, clientId, false, false, quality, refs));
        }
    }

    return { extractedData: extracted, pricing };
});
