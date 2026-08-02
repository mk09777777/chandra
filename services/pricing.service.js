const metalPricesService = require('./metalPrices.service');
const clientService = require('./client.service');
const { normalizeShape, isRoundShape } = require('../utils/shapes');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function normalizeNumber(num) {
    const n = parseFloat(num);
    return isNaN(n) ? num : n.toString();
}

function normalizeMmSize(value) {
    if (!value) return "";
    value = value.toLowerCase().trim();
    value = value.replace(/\s+/g, "");
    if (value.includes("x")) {
        const parts = value.split("x").map(v => normalizeNumber(v));
        return parts.join("x");
    }
    return normalizeNumber(value);
}

async function resolvePricingContext(pricingDetails, clientId, isOnlyMetalDesign = false, isRecalculate = false) {
    const todaysMetalRates = await metalPricesService.getLatest();

    const metalWeight = parseFloat(pricingDetails.Metal.Weight) || 0;
    const metalQuality = pricingDetails.Metal.Quality;
    const metalRateOverride = pricingDetails.Metal.Rate;
    const MetalOunceOverride = pricingDetails.Metal.GoldRatePerOunce;
    const quantity = pricingDetails.Quantity || 1;
    console.log(`[pricing] metalWeight: ${metalWeight}, metalQuality: ${metalQuality}, metalRateOverride: ${metalRateOverride}, MetalOunceOverride: ${MetalOunceOverride}, quantity: ${quantity}`);
    

    const gramRateFromOunce = MetalOunceOverride ? MetalOunceOverride / 31.1035 : null;
    let metalRate, metalFullRate;

    if (metalQuality === "Silver 925") {
        metalRate = gramRateFromOunce ?? metalRateOverride ?? todaysMetalRates.silver?.price ?? 0;
        metalFullRate = metalRate;
    } else if (metalQuality === "Platinum") {
        metalRate = gramRateFromOunce ?? metalRateOverride ?? todaysMetalRates.platinum?.price ?? 0;
        metalFullRate = metalRate;
    } else {
        const goldRate = gramRateFromOunce ?? metalRateOverride ?? todaysMetalRates.gold?.price ?? 0;
        metalFullRate = goldRate;

        const match = metalQuality?.toUpperCase().match(/^(\d{1,2})K$/);
        if (!match) throw new Error(`Invalid gold quality: ${metalQuality}`);

        metalRate = (goldRate * parseInt(match[1], 10)) / 24;
        console.log(`[pricing] gold rate: ${goldRate}, karat: ${match[1]}, metalRate: ${metalRate}`);
    }

    const client = await clientService.getClient(clientId);

    const duties = isRecalculate ? {
        natural: pricingDetails?.NaturalDuties ?? 0,
        lab: pricingDetails?.LabDuties ?? 0,
        gold: pricingDetails?.GoldDuties ?? 0,
        silverAndLab: pricingDetails?.SilverAndLabsDuties ?? 0,
        lossAndLabour: pricingDetails?.LossAndLabourDuties ?? 0
    } : {
        natural: client?.Pricing?.NaturalDuties ?? pricingDetails?.NaturalDuties ?? 0,
        lab: client?.Pricing?.LabDuties ?? pricingDetails?.LabDuties ?? 0,
        gold: client?.Pricing?.GoldDuties ?? pricingDetails?.GoldDuties ?? 0,
        silverAndLab: client?.Pricing?.SilverAndLabsDuties ?? pricingDetails?.SilverAndLabsDuties ?? 0,
        lossAndLabour: client?.Pricing?.LossAndLabourDuties ?? pricingDetails?.LossAndLabourDuties ?? 0
    };

    const charges = isRecalculate ? {
        loss: pricingDetails?.Loss ?? 0,
        labour: pricingDetails?.Labour ?? 0,
        extraCharges: pricingDetails?.ExtraCharges ?? { Type: 'percentage', Value: 0 },
        undercutPrice: pricingDetails?.UndercutPrice ?? 0
    } : {
        loss: client?.Pricing?.Loss ?? pricingDetails?.Loss ?? 0,
        labour: client?.Pricing?.Labour ?? pricingDetails?.Labour ?? 0,
        extraCharges: client?.Pricing?.ExtraCharges ?? pricingDetails?.ExtraCharges ?? { Type: 'percentage', Value: 0 },
        undercutPrice: client?.Pricing?.UndercutPrice ?? pricingDetails?.UndercutPrice ?? 0
    };

    let stones = pricingDetails.Stones;

    if (!isRecalculate && client) {
        stones = stones.map(stone => {
            const match = findStoneMatch(stone, client.Pricing.Diamonds);

            return {
                ...stone,
                Price: match?.Price ?? 0,
                Markup: 0
            };
        });
    }

    if (isOnlyMetalDesign) {
        stones = [];
    }

    return {
        metal: { weight: metalWeight, quality: metalQuality, rate: metalRate, fullRate: metalFullRate },
        stones,
        quantity,
        duties,
        charges,
        totalPieces: pricingDetails.TotalPieces,
        pricingMessageFormat: client?.PricingMessageFormat || null
    };
}

function findStoneMatch(stone, pricingDiamonds) {
    const nonRoundType = "Natural";
    const isNaturalVariant = stone.Type === "NaturalRegular" || stone.Type === "NaturalLower" || stone.Type === "TYPE 1" || stone.Type === "TYPE 2" || stone.Type === "TYPE 3";
    const stoneShape = normalizeShape(stone.Shape);
    const isNonRound = !isRoundShape(stone.Shape);

    // Helper to parse normalized size to number for comparison
    const parseSizeValue = (size) => {
        const normalized = normalizeMmSize(size);
        return parseFloat(normalized) || 0;
    };

    const stoneSize = parseSizeValue(stone.MmSize);
    const stoneWeight = parseFloat(stone.Weight) || 0;

    // Build filter based on type rules
    const baseFilter = (d) => {
        const typeMatch = isNaturalVariant && isNonRound
            ? d.Type === nonRoundType
            : d.Type === stone.Type;

        return typeMatch && normalizeShape(d.Shape) === stoneShape;
    };

    // First try: Find all matching candidates by mm size >= stone's mm size
    const sizeCandidates = pricingDiamonds.filter(d => {
        if (!baseFilter(d)) return false;
        const dbSize = parseSizeValue(d.MmSize);
        return dbSize >= stoneSize;
    });

    // Return the candidate with the smallest size >= stone size (closest threshold)
    if (sizeCandidates.length > 0) {
        return sizeCandidates.reduce((closest, current) => {
            const closestSize = parseSizeValue(closest.MmSize);
            const currentSize = parseSizeValue(current.MmSize);
            return currentSize < closestSize ? current : closest;
        });
    }

    // Fallback: If no mm size match, try matching by average weight/carat >= stone's weight.
    // Non-round pricing rows often store the threshold in Carat and keep MmSize at 0.
    const weightCandidates = pricingDiamonds.filter(d => {
        if (!baseFilter(d)) return false;
        const dbWeight = parseFloat(d.Weight ?? d.Carat) || 0;
        return dbWeight >= stoneWeight;
    });

    // Return the candidate with the smallest weight >= stone weight (closest threshold)
    if (weightCandidates.length > 0) {
        return weightCandidates.reduce((closest, current) => {
            const closestWeight = parseFloat(closest.Weight ?? closest.Carat) || 0;
            const currentWeight = parseFloat(current.Weight ?? current.Carat) || 0;
            return currentWeight < closestWeight ? current : closest;
        });
    }

    return null;
}


function calculatePricingEngine(context) {
    const { metal, stones, quantity, duties, charges } = context;

    const lossFactor = charges.loss / 100;
    console.log(`[pricing] lossFactor: ${lossFactor} (loss: ${charges.loss}%)`);

    const lossAmount = metal.weight * metal.rate * lossFactor;
    console.log(`[pricing] lossAmount: ${lossAmount} (weight: ${metal.weight} * rate: ${metal.rate} * lossFactor: ${lossFactor})`);

    const labourAmount = metal.weight * charges.labour;
    console.log(`[pricing] labourAmount: ${labourAmount} (weight: ${metal.weight} * labour: ${charges.labour})`);

    const metalPrice = metal.weight * ((metal.rate * (1 + lossFactor)) + charges.labour);
    console.log(`[pricing] metalPrice: ${metalPrice} (weight: ${metal.weight}, rate: ${metal.rate}, lossFactor: ${lossFactor}, labour: ${charges.labour})`);

    // --- DIAMONDS ---
    let diamondsPrice = 0;
    let diamondWeight = 0;
    let totalPieces = 0;

    stones.forEach(stone => {
        const rate = stone.Price + (stone.Markup || 0);
        const stoneValue = stone.CtWeight * rate;
        console.log(`[pricing] stone [${stone.Type} ${stone.Shape}]: ctWeight: ${stone.CtWeight}, price: ${stone.Price}, markup: ${stone.Markup || 0}, rate: ${rate}, value: ${stoneValue}`);
        diamondsPrice += stoneValue;
        diamondWeight += stone.CtWeight;
        totalPieces += stone.Pcs || 0;
    });

    // --- CLASSIFICATION ---
    const isLab = (t) => t === 'LabGrown' || t === 'CVDLabGrown';
    const isSilver = metal.quality === 'Silver 925';
    const isGold = !isSilver && metal.quality !== 'Platinum';

    let naturalBase = 0, labGoldBase = 0, labSilverBase = 0;

    stones.forEach(stone => {
        const val = stone.CtWeight * (stone.Price + (stone.Markup || 0));
        if (isLab(stone.Type)) {
            if (isSilver) labSilverBase += val;
            else labGoldBase += val;
        } else {
            naturalBase += val;
        }
    });
    console.log(`[pricing] bases — naturalBase: ${naturalBase}, labGoldBase: ${labGoldBase}, labSilverBase: ${labSilverBase}`);

    const goldBase = isGold ? metalPrice : 0;
    const silverBase = isSilver ? metalPrice : 0;
    console.log(`[pricing] goldBase: ${goldBase}, silverBase: ${silverBase} (isGold: ${isGold}, isSilver: ${isSilver})`);

    const lossAndLabourBase = lossAmount + labourAmount;
    console.log(`[pricing] lossAndLabourBase: ${lossAndLabourBase} (lossAmount: ${lossAmount} + labourAmount: ${labourAmount})`);

    // --- NATURAL DUTIES BASE (capped at undercutPrice if provided) ---
    let naturalBaseCappedForDuties = 0;
    stones.forEach(stone => {
        if (!isLab(stone.Type)) {
            const stonePrice = stone.Price + (stone.Markup || 0);
            const stonePriceCapped = charges.undercutPrice > 0 
                ? Math.min(stonePrice, charges.undercutPrice)
                : stonePrice;
            const val = stone.CtWeight * stonePriceCapped;
            naturalBaseCappedForDuties += val;
        }
    });
    console.log(`[pricing] naturalBaseCappedForDuties: ${naturalBaseCappedForDuties} (capped at undercutPrice: ${charges.undercutPrice})`);

    // --- DUTIES ---
    const breakdown = {
        natural: naturalBaseCappedForDuties * quantity * duties.natural / 100,
        lab: labGoldBase * quantity * duties.lab / 100,
        gold: goldBase * quantity * duties.gold / 100,
        silverAndLab:
            (labSilverBase + silverBase) * quantity * duties.silverAndLab / 100,
        lossAndLabour:
            lossAndLabourBase * quantity * duties.lossAndLabour / 100
    };
    console.log(`[pricing] duties breakdown:`, breakdown);

    const dutiesAmount = Object.values(breakdown).reduce((a, b) => a + b, 0);
    console.log(`[pricing] dutiesAmount: ${dutiesAmount}`);

    const metalBase = metal.weight * metal.rate;

    const naturalDutyWithoutUndercut = naturalBase * quantity * duties.natural / 100;
    const dutiesWithoutUndercut = dutiesAmount - breakdown.natural + naturalDutyWithoutUndercut;

    let totalPrice;
    if (charges.extraCharges.Type === 'fixed') {
        totalPrice = (((metalPrice + diamondsPrice) * quantity) + dutiesAmount) + charges.extraCharges.Value;
        console.log(`[pricing] totalPrice: ${totalPrice} (metalPrice: ${metalPrice}, diamondsPrice: ${diamondsPrice}, quantity: ${quantity}, dutiesAmount: ${dutiesAmount}, extraCharges: +${charges.extraCharges.Value} fixed)`);
    } else {
        totalPrice = (((metalPrice + diamondsPrice) * quantity) + dutiesAmount) * (1 + (charges.extraCharges.Value / 100));
        console.log(`[pricing] totalPrice: ${totalPrice} (metalPrice: ${metalPrice}, diamondsPrice: ${diamondsPrice}, quantity: ${quantity}, dutiesAmount: ${dutiesAmount}, extraCharges: ${charges.extraCharges.Value}%)`);
    }

    let totalPriceWithoutExtraCharges = ((metalPrice + diamondsPrice) * quantity) + dutiesAmount;
    console.log(`[pricing] totalPriceWithoutExtraCharges: ${totalPriceWithoutExtraCharges}`);

    // Pricing is incomplete if any stone price is missing/0, or the metal rate/price is missing/0.
    // An incomplete total is not trustworthy, so report it as 0. (No stones → only the metal check applies.)
    const hasUnpricedStone = stones.some(stone => !(Number(stone.Price) > 0));
    const metalUnpriced = !(metal.rate > 0) || !(metalPrice > 0);
    if (hasUnpricedStone || metalUnpriced) {
        console.log(`[pricing] totalPrice forced to 0 (hasUnpricedStone: ${hasUnpricedStone}, metalUnpriced: ${metalUnpriced})`);
        totalPrice = 0;
        totalPriceWithoutExtraCharges = 0;
    }

    return {
        metalBase,
        lossAmount,
        labourAmount,
        metalPrice,
        diamondsPrice,
        diamondWeight,
        dutiesAmount,
        dutiesWithoutUndercut,
        breakdown,
        totalPrice,
        totalPriceWithoutExtraCharges,
        totalPieces,

        bases: {
            natural: naturalBase,
            labGold: labGoldBase,
            labSilver: labSilverBase,
            gold: goldBase,
            silver: silverBase,
            lossAndLabour: lossAndLabourBase
        },

        naturalDutyBase: naturalBaseCappedForDuties
    };
}

function formatPricingResponse(context, calc) {
    console.log(context);
    return {
        MetalKT: context.metal.quality,
        GoldRate24K: +context.metal.fullRate.toFixed(3),
        GoldRateKT: +context.metal.rate.toFixed(3),
        GoldRatePerOunce: +(context.metal.fullRate * 31.1035).toFixed(3),
        LossPercent: context.charges.loss,
        LabourPercent: context.charges.labour,
        ExtraChargesType: context.charges.extraCharges.Type,
        ExtraChargesPercent: context.charges.extraCharges.Type === 'percentage' ? context.charges.extraCharges.Value : 0,
        ExtraChargesAmount: +(calc.totalPrice - calc.totalPriceWithoutExtraCharges).toFixed(3),
        GoldWeight: context.metal.weight,
        GoldAmount: +calc.metalBase.toFixed(3),
        LossAmount: +calc.lossAmount.toFixed(3),
        LabourAmount: +calc.labourAmount.toFixed(3),
        GoldIncludingLabour: +calc.metalPrice.toFixed(3),
        MetalPrice: +calc.metalPrice.toFixed(3),
        DiamondsPrice: +calc.diamondsPrice.toFixed(3),
        TotalDuties: +calc.dutiesWithoutUndercut.toFixed(3),
        TotalDutiesWithUndercut: +calc.dutiesAmount.toFixed(3),
        DutiesAmount: +calc.dutiesAmount.toFixed(3),
        TotalPrice: +calc.totalPrice.toFixed(3),
        TotalPriceWithoutExtraCharges: +calc.totalPriceWithoutExtraCharges.toFixed(3),

        Applicable: {
            NaturalDuties: calc.bases.natural > 0,
            LabDuties: calc.bases.labGold > 0,
            GoldDuties: calc.bases.gold > 0,
            SilverAndLabsDuties: calc.bases.labSilver > 0,
            LossAndLabourDuties: calc.bases.lossAndLabour > 0
        },

        Duties: {
            ...(calc.naturalDutyBase > 0 && {
                Natural: {
                    Rate: context.duties.natural,
                    BaseAmount: +(calc.naturalDutyBase * context.quantity).toFixed(3),
                    Amount: +calc.breakdown.natural.toFixed(3)
                }
            }),
            ...(calc.bases.labGold > 0 && {
                Lab: {
                    Rate: context.duties.lab,
                    BaseAmount: +(calc.bases.labGold * context.quantity).toFixed(3),
                    Amount: +calc.breakdown.lab.toFixed(3)
                }
            }),
            ...(calc.bases.gold > 0 && {
                Gold: {
                    Rate: context.duties.gold,
                    BaseAmount: +(calc.bases.gold * context.quantity).toFixed(3),
                    Amount: +calc.breakdown.gold.toFixed(3)
                }
            }),
            ...((calc.bases.labSilver + calc.bases.silver) > 0 && {
                SilverAndLabs: {
                    Rate: context.duties.silverAndLab,
                    BaseAmount: +((calc.bases.labSilver + calc.bases.silver) * context.quantity).toFixed(3),
                    Amount: +calc.breakdown.silverAndLab.toFixed(3)
                }
            }),
            ...(calc.bases.lossAndLabour > 0 && {
                LossAndLabour: {
                    Rate: context.duties.lossAndLabour,
                    BaseAmount: +(calc.bases.lossAndLabour * context.quantity).toFixed(3),
                    Amount: +calc.breakdown.lossAndLabour.toFixed(3)
                }
            })
        },

        Metal: {
            Weight: context.metal.weight,
            Quality: context.metal.quality,
            Rate: +context.metal.fullRate.toFixed(3)
        },

        DiamondWeight: +calc.diamondWeight.toFixed(3),
        TotalPieces: calc.totalPieces,

        Stones: context.stones.map(stone => ({
            Type: stone.Type,
            Color: stone.Color,
            Shape: stone.Shape,
            MmSize: stone.MmSize,
            SieveSize: stone.SieveSize,
            Weight: stone.Weight,
            Pcs: stone.Pcs,
            CtWeight: stone.CtWeight,
            Price: +((stone.Price ?? 0).toFixed(3)),
            Markup: +((stone.Markup ?? 0).toFixed(3))
        })),

        Client: {
            Loss: context.charges.loss,
            Labour: context.charges.labour,
            ExtraCharges: context.charges.extraCharges,
            UndercutPrice: context.charges.undercutPrice,
            NaturalDuties: context.duties.natural,
            LabDuties: context.duties.lab,
            GoldDuties: context.duties.gold,
            SilverAndLabsDuties: context.duties.silverAndLab,
            LossAndLabourDuties: context.duties.lossAndLabour,
            PricingMessageFormat: context.pricingMessageFormat
        }
    };
}

async function generatePricingMessage(pricingResponse, pricingMessageFormat) {
    // If no format is provided, return null
    if (!pricingMessageFormat) return null;

    try {
        const res = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            temperature: 0,
            messages: [
                {
                    role: 'system',
                    content: `You are a jewellery pricing message formatter. Format the pricing details according to the client's specified format template.
The format template may include placeholders like {TotalPrice}$, {MetalPrice}$, {DiamondsPrice}$, {DutiesAmount}$, {DiamondWeight}, {TotalPieces}, etc.
Generate a professional, concise pricing message following the exact format provided.`,
                },
                {
                    role: 'user',
                    content: `Format Template:\n${pricingMessageFormat}\n\nPricing Details:\n${JSON.stringify(pricingResponse, null, 2)}\n\nGenerate the formatted pricing message:`,
                },
            ],
        });

        return res.choices[0].message.content;
    } catch (error) {
        console.error('[pricing] Error generating pricing message:', error);
        return null;
    }
}

async function calculatePricing(pricingDetails, clientId, isOnlyMetalDesign = false, isRecalculate = false) {
    const context = await resolvePricingContext(pricingDetails, clientId, isOnlyMetalDesign, isRecalculate);
    const calculation = calculatePricingEngine(context);
    const result = formatPricingResponse(context, calculation);

    if (context.pricingMessageFormat) {
        result.ClientPricingMessage = await generatePricingMessage(result, context.pricingMessageFormat);
    }

    return result;
}

module.exports = {
    calculatePricing,
    resolvePricingContext,
    calculatePricingEngine,
    formatPricingResponse,
    generatePricingMessage,
    normalizeMmSize
};
