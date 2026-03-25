import { searchByKeywords, searchByGtin, searchByImage, summarizeItems, roundMoney } from "./_lib/ebay.js";
import { demandSignalFromCount, decisionFromMetrics, buildRecommendation } from "../lib/pricing-engine.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fallbackTitle({ brand, titleHint, size, condition }) {
  return cleanText([brand, titleHint, size, condition].filter(Boolean).join(" "));
}

function buildMarketplaceRows(suggestedPrice) {
  return [
    { platform: "eBay", medianSold: suggestedPrice, speed: "Live" },
    { platform: "Mercari", medianSold: roundMoney(suggestedPrice * 0.95), speed: "Planned" },
    { platform: "Poshmark", medianSold: roundMoney(suggestedPrice * 1.1), speed: "Planned" },
    { platform: "Depop", medianSold: roundMoney(suggestedPrice * 0.9), speed: "Planned" }
  ];
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const {
      scanMode = "photo",
      imageBase64 = "",
      brand = "",
      titleHint = "",
      size = "",
      condition = "Pre-Owned",
      buyCost = 0,
      shippingCost = 0,
      shippingType = "buyer_pays",
      gtin = ""
    } = req.body || {};

    const queryFallback = fallbackTitle({ brand, titleHint, size, condition });
    let items = [];

    if (scanMode === "upc" && cleanText(gtin)) {
      items = await searchByGtin(cleanText(gtin));
    } else if (scanMode === "photo" && imageBase64) {
      items = await searchByImage(imageBase64);
    } else if (queryFallback) {
      items = await searchByKeywords(queryFallback);
    }

    if (!items.length && queryFallback) {
      items = await searchByKeywords(queryFallback);
    }

    if (!items.length) {
      return res.status(404).json({ ok: false, error: "No live matches found." });
    }

    const summary = summarizeItems(items);
    const suggestedPrice = summary.medianPrice;
    const lowPrice = roundMoney(summary.lowPrice || suggestedPrice * 0.9);
    const highPrice = roundMoney(summary.highPrice || suggestedPrice * 1.1);
    const feeRate = 0.13;
    const sellerShipping = shippingType === "seller_pays" ? Number(shippingCost || 0) : 0;
    const estimatedProfit = roundMoney(suggestedPrice - suggestedPrice * feeRate - Number(buyCost || 0) - sellerShipping);
    const roi = Number(buyCost || 0) > 0 ? roundMoney((estimatedProfit / Number(buyCost || 0)) * 100) : 0;
    const demandSignal = demandSignalFromCount(summary.count);
    const decision = decisionFromMetrics({ estimatedProfit, roi, demandSignal });
    const cleanedTitle = cleanText(summary.cleanedTitle || queryFallback || "Unknown Item");
    const marketplaces = buildMarketplaceRows(suggestedPrice);
    const recommendation = buildRecommendation({
      decision,
      bestPlatform: "eBay",
      cleanedTitle
    });

    return res.status(200).json({
      ok: true,
      result: {
        cleanedTitle,
        suggestedPrice,
        lowPrice,
        highPrice,
        sellThrough: Math.min(95, Math.max(20, summary.count * 4)),
        demandSignal,
        estimatedProfit,
        roi,
        decision,
        highestSalePlatform: "Poshmark",
        fastestMovingPlatform: "eBay",
        bestOverallPlatform: "eBay",
        recommendation,
        marketplaces
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Server error" });
  }
}
