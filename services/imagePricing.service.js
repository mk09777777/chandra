const sharp = require('sharp');
const OpenAI = require('openai');
const { calculatePricing } = require('./pricing.service');
const { createConcurrencyLimiter } = require('../utils/concurrency');
const stoneMaster = require('../data/stoneMaster.json');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 9000,
    maxRetries: 0
});

const OPENAI_MODEL = 'gpt-5.6-sol';

const OPENAI_CONCURRENCY = 3;

const limitOpenAI =
    createConcurrencyLimiter(
        OPENAI_CONCURRENCY
    );

const stoneItemSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        Color: {
            type: ['string', 'null']
        },
        Shape: {
            type: ['string', 'null']
        },
        MmSize: {
            type: ['string', 'null']
        },
        SieveSize: {
            type: ['string', 'null']
        },
        Weight: {
            type: ['number', 'null']
        },
        Pcs: {
            type: ['number', 'null']
        },
        CtWeight: {
            type: ['number', 'null']
        }
    },
    required: [
        'Color',
        'Shape',
        'MmSize',
        'SieveSize',
        'Weight',
        'Pcs',
        'CtWeight'
    ]
};

const extractionSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        Stones: {
            type: 'array',
            items: stoneItemSchema
        },
        Metal: {
            type: 'object',
            additionalProperties: false,
            properties: {
                Weight: {
                    type: ['number', 'null']
                },
                Quality: {
                    type: ['string', 'null']
                }
            },
            required: [
                'Weight',
                'Quality'
            ]
        }
    },
    required: [
        'Stones',
        'Metal'
    ]
};

const SYSTEM_INSTRUCTION = `
You are a high-precision jewelry table transcription engine.

Extract the Diamond Specification Table exactly as visible.

Columns:
DIA/COL
ST SHAPE
SIEVE SIZE
MM SIZE
AVRG WT
PCS
CT WT

Extract every visible row exactly once.
Preserve all values exactly as printed.
Preserve decimals exactly.
Never calculate missing values.
Never estimate unreadable values.
Never merge rows.
Never split rows.
Return null when a value cannot be read reliably.
Extract metal weight and quality only when visible.
Return only the required structured data.
`;

async function cropByFractions(buffer, crop) {
    if (!crop) return buffer;

    const {
        x = 0,
        y = 0,
        w = 1,
        h = 1
    } = crop;

    if (
        !(x > 0) &&
        !(y > 0) &&
        !(w < 1) &&
        !(h < 1)
    ) {
        return buffer;
    }

    const meta = await sharp(buffer)
        .rotate()
        .metadata();

    const W = meta.width;
    const H = meta.height;

    if (!W || !H) {
        return buffer;
    }

    const left = Math.max(
        0,
        Math.min(
            W - 1,
            Math.round(x * W)
        )
    );

    const top = Math.max(
        0,
        Math.min(
            H - 1,
            Math.round(y * H)
        )
    );

    const width = Math.max(
        1,
        Math.min(
            W - left,
            Math.round(w * W)
        )
    );

    const height = Math.max(
        1,
        Math.min(
            H - top,
            Math.round(h * H)
        )
    );

    return sharp(buffer)
        .rotate()
        .extract({
            left,
            top,
            width,
            height
        })
        .toBuffer();
}

function normalizeMm(value) {
    if (value == null) return null;

    const match = String(value)
        .replace(/\s+/g, '')
        .match(/\d+(?:\.\d+)?/);

    if (!match) return null;

    return Number(match[0])
        .toFixed(2);
}

function normalizeSieve(value) {
    if (value == null) return null;

    const normalized = String(value)
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/CRD/g, '')
        .trim();

    if (
        !normalized ||
        normalized === '#N/A' ||
        normalized === 'N/A' ||
        normalized === 'NA' ||
        normalized === '-'
    ) {
        return null;
    }

    return normalized;
}

function withinTolerance(
    actual,
    expected,
    absoluteTolerance,
    relativeTolerance
) {
    const a = Number(actual);
    const e = Number(expected);

    if (
        !Number.isFinite(a) ||
        !Number.isFinite(e)
    ) {
        return null;
    }

    const difference =
        Math.abs(a - e);

    const tolerance =
        Math.max(
            absoluteTolerance,
            Math.abs(e) * relativeTolerance
        );

    return difference <= tolerance;
}

function validateMath(row) {
    const pcs = Number(row.Pcs);
    const weight = Number(row.Weight);
    const ctWeight = Number(row.CtWeight);

    if (
        !Number.isFinite(pcs) ||
        !Number.isFinite(weight) ||
        !Number.isFinite(ctWeight) ||
        pcs <= 0 ||
        weight < 0 ||
        ctWeight < 0
    ) {
        return null;
    }

    const expectedCtWeight =
        pcs * weight;

    return withinTolerance(
        ctWeight,
        expectedCtWeight,
        0.01,
        0.03
    );
}

function validateMaster(row) {
    const mm =
        normalizeMm(row.MmSize);

    if (!mm) {
        return {
            masterFound: false,
            mmValid: null,
            sieveValid: null,
            weightValid: null
        };
    }

    const master =
        stoneMaster[mm];

    if (!master) {
        return {
            masterFound: false,
            mmValid: null,
            sieveValid: null,
            weightValid: null
        };
    }

    const extractedSieve =
        normalizeSieve(
            row.SieveSize
        );

    const masterSieves =
        (master.sieveSizes || [])
            .map(normalizeSieve)
            .filter(Boolean);

    let sieveValid = null;

    if (
        extractedSieve &&
        masterSieves.length
    ) {
        sieveValid =
            masterSieves.includes(
                extractedSieve
            );
    }

    const weight =
        Number(row.Weight);

    const masterWeights =
        (master.avgWeights || [])
            .map(Number)
            .filter(Number.isFinite);

    let weightValid = null;

    if (
        Number.isFinite(weight) &&
        masterWeights.length
    ) {
        weightValid =
            masterWeights.some(
                masterWeight =>
                    withinTolerance(
                        weight,
                        masterWeight,
                        0.002,
                        0.08
                    )
            );
    }

    return {
        masterFound: true,
        mmValid: true,
        sieveValid,
        weightValid
    };
}

function validateStoneRow(row) {
    const mathValid =
        validateMath(row);

    const master =
        validateMaster(row);

    const checks = [
        mathValid,
        master.sieveValid,
        master.weightValid
    ].filter(
        value => value !== null
    );

    const passed =
        checks.some(
            value => value === true
        );

    return {
        ...row,
        Valid: passed,
        NeedsReview:
            checks.length > 0 &&
            !passed,
        Validation: {
            MmSize:
                master.mmValid,
            SieveSize:
                master.sieveValid,
            AvgWeight:
                master.weightValid,
            CtWeight:
                mathValid
        }
    };
}

function calculateTotalPieces(stones) {
    return stones.reduce(
        (total, stone) => {
            const pcs =
                Number(stone.Pcs);

            if (
                !Number.isFinite(pcs) ||
                pcs < 0
            ) {
                return total;
            }

            return total + pcs;
        },
        0
    );
}

const callOpenAI = limitOpenAI(
    async function (base64, mimeType) {
        const startTime =
            Date.now();

        const response =
            await openai.responses.create({
                model: OPENAI_MODEL,

                service_tier: 'fast',

                reasoning: {
                    effort: 'none'
                },

                instructions:
                    SYSTEM_INSTRUCTION,

                input: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'input_text',
                                text: 'Extract the visible jewelry table exactly.'
                            },
                            {
                                type: 'input_image',
                                image_url:
                                    `data:${mimeType};base64,${base64}`,
                                detail: 'original'
                            }
                        ]
                    }
                ],

                text: {
                    format: {
                        type: 'json_schema',
                        name: 'jewelry_extraction',
                        strict: true,
                        schema: extractionSchema
                    }
                }
            });

        const responseMs =
            Date.now() -
            startTime;

        console.log(
            `[imagePricing] OpenAI response time: ${responseMs}ms`
        );

        return response;
    }
);

async function extractPricingDataFromImage(
    imageBuffer,
    mimeType
) {
    const base64 =
        imageBuffer.toString(
            'base64'
        );

    const response =
        await callOpenAI(
            base64,
            mimeType
        );

    let extracted;

    try {
        extracted =
            JSON.parse(
                response.output_text
            );
    } catch (err) {
        throw new Error(
            'AI returned unparseable extraction output'
        );
    }

    const stones =
        (extracted.Stones || [])
            .map(
                validateStoneRow
            );

    return {
        Stones: stones,

        Metal:
            extracted.Metal || {
                Weight: null,
                Quality: null
            },

        TotalPieces:
            calculateTotalPieces(
                stones
            )
    };
}

function validateExtracted(data) {
    if (
        !data ||
        typeof data !== 'object'
    ) {
        throw new Error(
            'AI returned invalid data'
        );
    }

    if (
        !Array.isArray(
            data.Stones
        )
    ) {
        throw new Error(
            'AI response missing Stones array'
        );
    }

    if (
        !data.Metal ||
        typeof data.Metal !== 'object'
    ) {
        throw new Error(
            'AI response missing Metal object'
        );
    }

    return data;
}

exports.extractPricingDataFromImage =
    extractPricingDataFromImage;

exports.SYSTEM_INSTRUCTION =
    SYSTEM_INSTRUCTION;

exports.extractionSchema =
    extractionSchema;

exports.cropByFractions =
    cropByFractions;

exports.validateStoneRow =
    validateStoneRow;

exports.calculateTotalPieces =
    calculateTotalPieces;

exports.normalizeMm =
    normalizeMm;

exports.normalizeSieve =
    normalizeSieve;

exports.validateExtracted =
    validateExtracted;

exports.extractAndPrice =
async ({
    imageBuffer,
    mimeType,
    clientId,
    stoneType,
    quantity,
    metalQuality,
    crop
}) => {
    let workingBuffer =
        await cropByFractions(
            imageBuffer,
            crop
        );

    imageBuffer = null;

    const extracted =
        validateExtracted(
            await extractPricingDataFromImage(
                workingBuffer,
                mimeType
            )
        );

    workingBuffer = null;

    const reviewRows =
        extracted.Stones.filter(
            stone =>
                stone.NeedsReview
        );

    if (reviewRows.length) {
        console.warn(
            '[imagePricing] rows need review:',
            JSON.stringify(
                reviewRows,
                null,
                2
            )
        );
    }

    const resolvedMetalQuality =
        metalQuality ||
        null;

    const pricingDetails = {
        Metal: {
            Weight:
                extracted.Metal?.Weight ??
                null,

            Quality:
                resolvedMetalQuality
        },

        Quantity:
            quantity || 1,

        Stones:
            extracted.Stones.map(
                stone => ({
                    Color:
                        stone.Color,

                    Shape:
                        stone.Shape,

                    MmSize:
                        stone.MmSize,

                    SieveSize:
                        stone.SieveSize,

                    Weight:
                        stone.Weight,

                    Pcs:
                        stone.Pcs,

                    CtWeight:
                        stone.CtWeight,

                    Type:
                        stoneType || '',

                    Markup:
                        0
                })
            ),

        TotalPieces:
            extracted.TotalPieces
    };

    const pricing =
        await calculatePricing(
            pricingDetails,
            clientId
        );

    return {
        extractedData:
            extracted,
        pricing
    };
};
