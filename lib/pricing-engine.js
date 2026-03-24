function median(values = []) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0
    ? Number(((clean[mid - 1] + clean[mid]) / 2).toFixed(2))
    : Number(clean[mid].toFixed(2));
}

function average(values = []) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return 0;
  return Number((clean.reduce((sum, v) => sum + v, 0) / clean.length).toFixed(2));
}

function percentile(values = [], p = 0.5) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const index = Math.min(clean.length - 1, Math.max(0, Math.floor((clean.length - 1) * p)));
  return Number(clean[index].toFixed(2));
}

function removeOutliersByIQR(values = []) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (clean.length < 4) return clean;

  const q1 = percentile(clean, 0.25);
  const q3 = percentile(clean, 0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;

  return clean.filter((v) => v >= low && v <= high);
}

function roundCharm(value, style = "99") {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const whole = Math.floor(value);
  if (style === "00") return Number(whole.toFixed(2));
  return Number((whole + 0.99).toFixed(2));
}

function classifySellThrough(rate) {
  if (rate >= 0.8) return "VERY_FAST";
  if (rate >= 0.5) return "GOOD";
  if (rate >= 0.3) return "OK";
  return "SLOW";
}

function estimateDaysToSell(rate) {
  if (rate >= 1.0) return "1-7 days";
  if (rate >= 0.8) return "7-14 days";
  if (rate >= 0.5) return "14-30 days";
  if (rate >= 0.3) return "30-60 days";
  if (rate >= 0.15) return "60-90 days";
  return "90+ days";
}

function feeAmount(platform, salePrice) {
  const p = Number(salePrice || 0);

  switch (platform) {
    case "ebay":
      return p * 0.1325 + 0.4;
    case "poshmark":
      return p < 15 ? 2.95 : p * 0.2;
    case "mercari":
      return p * 0.129 + 0.5;
    case "depop":
      return p * 0.133 + 0.45;
    default:
      return p * 0.13;
  }
}

function profitAfterFees({
  platform,
  salePrice,
  buyCost = 0,
  shippingCost = 0,
  buyerPaysShipping = true,
}) {
  const fees = feeAmount(platform, salePrice);
  const shippingHit = buyerPaysShipping ? 0 : Number(shippingCost || 0);
  const profit = Number((salePrice - fees - Number(buyCost || 0) - shippingHit).toFixed(2));

  return {
    fees: Number(fees.toFixed(2)),
    profit,
  };
}

function verdictFromMetrics({ roi, profit, sellThroughRate }) {
  if (roi >= 2 && profit >= 12 && sellThroughRate >= 0.5) return "BUY";
  if (roi >= 1.5 && profit >= 8 && sellThroughRate >= 0.3) return "HOLD";
  return "PASS";
}

function platformAdjustments(basePrice, keywordBlob = "") {
  const text = String(keywordBlob || "").toLowerCase();

  const isStreetwear =
    /vintage|graphic|band|y2k|grunge|rare|single stitch|streetwear/.test(text);

  const isAthletic =
    /nike|athleta|lululemon|under armour|underarmour|adidas|golf|activewear|leggings|running/.test(text);

  const ebay = roundCharm(basePrice, "99");
  const poshmark = roundCharm(basePrice * 1.12, "00");
  const mercari = roundCharm(basePrice * 0.95, "99");
  const depop = roundCharm(basePrice * (isStreetwear ? 1.12 : isAthletic ? 1.02 : 1.05), "99");

  return { ebay, poshmark, mercari, depop };
}

export function runPricingEngine({
  title = "",
  activeComps = [],
  soldComps = [],
  buyCost = 0,
  shippingCost = 0,
  buyerPaysShipping = true,
}) {
  const activePricesRaw = activeComps.map((x) => Number(x.price)).filter(Number.isFinite);
  const soldPricesRaw = soldComps.map((x) => Number(x.price)).filter(Number.isFinite);

  const activePrices = removeOutliersByIQR(activePricesRaw);
  const soldPrices = removeOutliersByIQR(soldPricesRaw);

  const medianActive = median(activePrices);
  const medianSold = median(soldPrices);
  const averageSold = average(soldPrices);
  const soldLow = percentile(soldPrices, 0.25);
  const soldHigh = percentile(soldPrices, 0.75);

  const activeCount = activeComps.length;
  const soldCount = soldComps.length;
  const sellThroughRate = activeCount > 0 ? soldCount / activeCount : 0;
  const sellThroughPercent = Number((sellThroughRate * 100).toFixed(1));
  const velocity = classifySellThrough(sellThroughRate);

  let recommendedBase = medianSold || medianActive || averageSold || 0;

  if (sellThroughRate >= 0.8) {
    recommendedBase = medianSold || recommendedBase;
  } else if (sellThroughRate >= 0.5) {
    recommendedBase = medianSold ? medianSold * 0.98 : recommendedBase;
  } else if (sellThroughRate >= 0.3) {
    recommendedBase = medianActive ? medianActive * 0.93 : recommendedBase;
  } else {
    recommendedBase = medianActive ? medianActive * 0.88 : recommendedBase;
  }

  const pricing = platformAdjustments(recommendedBase, title);

  const ebayMetrics = profitAfterFees({
    platform: "ebay",
    salePrice: pricing.ebay,
    buyCost,
    shippingCost,
    buyerPaysShipping,
  });

  const roi = Number(buyCost) > 0 ? Number((ebayMetrics.profit / Number(buyCost)).toFixed(2)) : 0;
  const verdict = verdictFromMetrics({
    roi,
    profit: ebayMetrics.profit,
    sellThroughRate,
  });

  return {
    compStats: {
      activeCount,
      soldCount,
      medianActive,
      medianSold,
      averageSold,
      soldRangeLow: soldLow,
      soldRangeHigh: soldHigh,
    },
    sellThrough: {
      rate: Number(sellThroughRate.toFixed(3)),
      percent: sellThroughPercent,
      velocity,
      estimatedDaysToSell: estimateDaysToSell(sellThroughRate),
    },
    pricing,
    economics: {
      buyCost: Number(buyCost || 0),
      shippingCost: Number(shippingCost || 0),
      buyerPaysShipping: Boolean(buyerPaysShipping),
      ebayFees: ebayMetrics.fees,
      estimatedProfit: ebayMetrics.profit,
      roi,
    },
    verdict,
  };
}
