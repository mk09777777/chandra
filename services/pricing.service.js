const metalPricesService = require("./metalPrices.service");
const clientService = require("./client.service");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const geminiModel = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  systemInstruction: `You are a jewellery pricing message formatter. Format the pricing details according to the client's specified format template.
The format template may include placeholders like {TotalPrice}, {MetalPrice}, {DiamondsPrice}, {DutiesAmount}, {DiamondWeight}, {TotalPieces}, etc.
Generate a professional, concise pricing message following the exact format provided.`,
});

function normalizeNumber(num) {
  const n = parseFloat(num);
  return isNaN(n) ? num : n.toString();
}

function normalizeMmSize(value) {
  if (!value) return "";
  value = value.toLowerCase().trim();
  value = value.replace(/\s+/g, "");
  if (value.includes("x")) {
    const parts = value.split("x").map((v) => normalizeNumber(v));
    return parts.join("x");
  }
  return normalizeNumber(value);
}

async function resolvePricingContext(pricingDetails, clientId) {
  const todaysMetalRates = await metalPricesService.getLatest();

  const metalWeight = parseFloat(pricingDetails.Metal.Weight);
  const metalQuality = pricingDetails.Metal.Quality;
  const metalRateOverride = pricingDetails.Metal.Rate;
  const quantity = pricingDetails.Quantity || 1;

  let metalRate, metalFullRate;

  if (metalQuality === "Silver 925") {
    metalRate = metalRateOverride ?? todaysMetalRates.silver?.price ?? 0;
    metalFullRate = metalRate;
  } else if (metalQuality === "Platinum") {
    metalRate = metalRateOverride ?? todaysMetalRates.platinum?.price ?? 0;
    metalFullRate = metalRate;
  } else {
    const goldRate = metalRateOverride ?? todaysMetalRates.gold?.price ?? 0;
    metalFullRate = goldRate;

    const match = metalQuality?.toUpperCase().match(/^(\d{1,2})K$/);
    if (!match) throw new Error(`Invalid gold quality: ${metalQuality}`);

    metalRate = (goldRate * parseInt(match[1], 10)) / 24;
    console.log(
      `[pricing] gold rate: ${goldRate}, karat: ${match[1]}, metalRate: ${metalRate}`,
    );
  }

  let client = clientId ? await clientService.getClient(clientId) : null;

  const duties = {
    natural:
      pricingDetails?.NaturalDuties ?? client?.Pricing?.NaturalDuties ?? 0,
    lab: pricingDetails?.LabDuties ?? client?.Pricing?.LabDuties ?? 0,
    gold: pricingDetails?.GoldDuties ?? client?.Pricing?.GoldDuties ?? 0,
    silverAndLab:
      pricingDetails?.SilverAndLabsDuties ??
      client?.Pricing?.SilverAndLabsDuties ??
      0,
    lossAndLabour:
      pricingDetails?.LossAndLabourDuties ??
      client?.Pricing?.LossAndLabourDuties ??
      0,
  };

  const charges = {
    loss: pricingDetails?.Loss ?? client?.Pricing?.Loss ?? 0,
    labour: pricingDetails?.Labour ?? client?.Pricing?.Labour ?? 0,
    extraCharges:
      pricingDetails?.ExtraCharges ?? client?.Pricing?.ExtraCharges ?? 0,
    undercutPrice:
      pricingDetails?.UndercutPrice ?? client?.Pricing?.UndercutPrice ?? 0,
  };

  let stones = pricingDetails.Stones;

  if (client) {
    stones = stones.map((stone) => {
      const match = findStoneMatch(stone, client.Pricing.Diamonds);

      return {
        ...stone,
        Price: match?.Price ?? 0,
        Markup: 0,
      };
    });
  }

  return {
    metal: {
      weight: metalWeight,
      quality: metalQuality,
      rate: metalRate,
      fullRate: metalFullRate,
    },
    stones,
    quantity,
    duties,
    charges,
    totalPieces: pricingDetails.TotalPieces,
    pricingMessageFormat: client?.PricingMessageFormat || null,
  };
}

function findStoneMatch(stone, pricingDiamonds) {
  const nonRoundType = "Natural";
  const isNaturalVariant =
    stone.Type === "NaturalRegular" ||
    stone.Type === "NaturalLower" ||
    stone.Type === "TYPE 1" ||
    stone.Type === "TYPE 2" ||
    stone.Type === "TYPE 3";
  const isNonRound = stone.Shape !== roundIdentifier;

  // Helper to parse normalized size to number for comparison
  const parseSizeValue = (size) => {
    const normalized = normalizeMmSize(size);
    return parseFloat(normalized) || 0;
  };

  const stoneSize = parseSizeValue(stone.MmSize);
  const stoneWeight = parseFloat(stone.Weight) || 0;

  // Build filter based on type rules
  const baseFilter = (d) => {
    const typeMatch =
      isNaturalVariant && isNonRound
        ? d.Type === nonRoundType
        : d.Type === stone.Type;

    return typeMatch && d.Shape === stone.Shape;
  };

  // First try: Find all matching candidates by mm size >= stone's mm size
  const sizeCandidates = pricingDiamonds.filter((d) => {
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

  // Fallback: If no mm size match, try matching by average weight >= stone's weight
  const weightCandidates = pricingDiamonds.filter((d) => {
    if (!baseFilter(d)) return false;
    const dbWeight = parseFloat(d.Weight) || 0;
    return dbWeight >= stoneWeight;
  });

  // Return the candidate with the smallest weight >= stone weight (closest threshold)
  if (weightCandidates.length > 0) {
    return weightCandidates.reduce((closest, current) => {
      const closestWeight = parseFloat(closest.Weight) || 0;
      const currentWeight = parseFloat(current.Weight) || 0;
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
  console.log(
    `[pricing] lossAmount: ${lossAmount} (weight: ${metal.weight} * rate: ${metal.rate} * lossFactor: ${lossFactor})`,
  );

  const labourAmount = metal.weight * charges.labour;
  console.log(
    `[pricing] labourAmount: ${labourAmount} (weight: ${metal.weight} * labour: ${charges.labour})`,
  );

  const metalPrice =
    metal.weight * (metal.rate * (1 + lossFactor) + charges.labour);
  console.log(
    `[pricing] metalPrice: ${metalPrice} (weight: ${metal.weight}, rate: ${metal.rate}, lossFactor: ${lossFactor}, labour: ${charges.labour})`,
  );

  // --- DIAMONDS ---
  let diamondsPrice = 0;
  let diamondWeight = 0;
  let totalPieces = 0;

  stones.forEach((stone) => {
    const rate = stone.Price + (stone.Markup || 0);
    const stoneValue = stone.CtWeight * rate;
    console.log(
      `[pricing] stone [${stone.Type} ${stone.Shape}]: ctWeight: ${stone.CtWeight}, price: ${stone.Price}, markup: ${stone.Markup || 0}, rate: ${rate}, value: ${stoneValue}`,
    );
    diamondsPrice += stoneValue;
    diamondWeight += stone.CtWeight;
    totalPieces += stone.Pcs || 0;
  });

  // --- CLASSIFICATION ---
  const isLab = (t) => t === "LabGrown" || t === "CVDLabGrown";
  const isSilver = metal.quality === "Silver 925";
  const isGold = !isSilver && metal.quality !== "Platinum";

  let naturalBase = 0,
    labGoldBase = 0,
    labSilverBase = 0;

  stones.forEach((stone) => {
    const val = stone.CtWeight * (stone.Price + (stone.Markup || 0));
    if (isLab(stone.Type)) {
      if (isSilver) labSilverBase += val;
      else labGoldBase += val;
    } else {
      naturalBase += val;
    }
  });
  console.log(
    `[pricing] bases — naturalBase: ${naturalBase}, labGoldBase: ${labGoldBase}, labSilverBase: ${labSilverBase}`,
  );

  const goldBase = isGold ? metalPrice : 0;
  const silverBase = isSilver ? metalPrice : 0;
  console.log(
    `[pricing] goldBase: ${goldBase}, silverBase: ${silverBase} (isGold: ${isGold}, isSilver: ${isSilver})`,
  );

  const lossAndLabourBase = lossAmount + labourAmount;
  console.log(
    `[pricing] lossAndLabourBase: ${lossAndLabourBase} (lossAmount: ${lossAmount} + labourAmount: ${labourAmount})`,
  );

  // --- NATURAL DUTIES BASE (capped at undercutPrice if provided) ---
  let naturalBaseCappedForDuties = 0;
  stones.forEach((stone) => {
    if (!isLab(stone.Type)) {
      const stonePrice = stone.Price + (stone.Markup || 0);
      const stonePriceCapped =
        charges.undercutPrice > 0
          ? Math.min(stonePrice, charges.undercutPrice)
          : stonePrice;
      const val = stone.CtWeight * stonePriceCapped;
      naturalBaseCappedForDuties += val;
    }
  });
  console.log(
    `[pricing] naturalBaseCappedForDuties: ${naturalBaseCappedForDuties} (capped at undercutPrice: ${charges.undercutPrice})`,
  );

  // --- DUTIES ---
  const breakdown = {
    natural: (naturalBaseCappedForDuties * quantity * duties.natural) / 100,
    lab: (labGoldBase * quantity * duties.lab) / 100,
    gold: (goldBase * quantity * duties.gold) / 100,
    silverAndLab:
      ((labSilverBase + silverBase) * quantity * duties.silverAndLab) / 100,
    lossAndLabour: (lossAndLabourBase * quantity * duties.lossAndLabour) / 100,
  };
  console.log(`[pricing] duties breakdown:`, breakdown);

  const dutiesAmount = Object.values(breakdown).reduce((a, b) => a + b, 0);
  console.log(`[pricing] dutiesAmount: ${dutiesAmount}`);

  const totalPrice =
    ((metalPrice + diamondsPrice) * quantity + dutiesAmount) *
    (1 + charges.extraCharges / 100);
  console.log(
    `[pricing] totalPrice: ${totalPrice} (metalPrice: ${metalPrice}, diamondsPrice: ${diamondsPrice}, quantity: ${quantity}, dutiesAmount: ${dutiesAmount}, extraCharges: ${charges.extraCharges}%)`,
  );

  return {
    metalPrice,
    diamondsPrice,
    diamondWeight,
    dutiesAmount,
    breakdown,
    totalPrice,
    totalPieces,

    // 🔥 THIS IS THE KEY FIX
    bases: {
      natural: naturalBase,
      labGold: labGoldBase,
      labSilver: labSilverBase,
      gold: goldBase,
      silver: silverBase,
      lossAndLabour: lossAndLabourBase,
    },
  };
}

function formatPricingResponse(context, calc) {
  console.log(context);
  return {
    MetalPrice: +calc.metalPrice.toFixed(3),
    DiamondsPrice: +calc.diamondsPrice.toFixed(3),
    TotalPrice: +calc.totalPrice.toFixed(3),

    DutiesAmount: +calc.dutiesAmount.toFixed(3),

    Applicable: {
      NaturalDuties: calc.bases.natural > 0,
      LabDuties: calc.bases.labGold > 0,
      GoldDuties: calc.bases.gold > 0,
      SilverAndLabsDuties: calc.bases.labSilver > 0,
      LossAndLabourDuties: calc.bases.lossAndLabour > 0,
    },

    Metal: {
      Weight: context.metal.weight,
      Quality: context.metal.quality,
      Rate: +context.metal.fullRate.toFixed(3),
    },

    DiamondWeight: +calc.diamondWeight.toFixed(3),
    TotalPieces: calc.totalPieces,

    Stones: context.stones.map((stone) => ({
      Type: stone.Type,
      Color: stone.Color,
      Shape: stone.Shape,
      MmSize: stone.MmSize,
      SieveSize: stone.SieveSize,
      Weight: stone.Weight,
      Pcs: stone.Pcs,
      CtWeight: stone.CtWeight,
      Price: +(stone.Price ?? 0).toFixed(3),
      Markup: +(stone.Markup ?? 0).toFixed(3),
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
      PricingMessageFormat: context.pricingMessageFormat,
    },
  };
}

async function generatePricingMessage(pricingResponse, pricingMessageFormat) {
  // If no format is provided, return null
  if (!pricingMessageFormat) return null;

  try {
    const res = await geminiModel.generateContent(
      `Format Template:\n${pricingMessageFormat}\n\nPricing Details:\n${JSON.stringify(pricingResponse, null, 2)}\n\nGenerate the formatted pricing message:`,
    );

    return res.response.text();
  } catch (error) {
    console.error("[pricing] Error generating pricing message:", error);
    return null;
  }
}

function hasCompleteData(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0 && value.every(hasCompleteData);
  }

  if (typeof value === "object") {
    return Object.values(value).every(hasCompleteData);
  }

  return true;
}

async function calculatePricing(pricingDetails, clientId) {
  const context = await resolvePricingContext(pricingDetails, clientId);
  const calculation = calculatePricingEngine(context);
  const result = formatPricingResponse(context, calculation);

  const hasCompletePricingData = hasCompleteData(result);

  if (context.pricingMessageFormat && hasCompletePricingData) {
    result.ClientPricingMessage = await generatePricingMessage(
      result,
      context.pricingMessageFormat,
    );
  } else {
    result.ClientPricingMessage = null;
  }

  return result;
}

module.exports = {
  calculatePricing,
  resolvePricingContext,
  calculatePricingEngine,
  formatPricingResponse,
  generatePricingMessage,
  normalizeMmSize,
};
