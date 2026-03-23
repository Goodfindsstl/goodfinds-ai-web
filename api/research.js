const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const EBAY_FINDING_URL = "https://svcs.ebay.com/services/search/FindingService/v1";
const DEFAULT_FEE_PERCENT = 0.1325;
const DEFAULT_ORDER_FEE = 0.3;
const MAX_ACTIVE_RESULTS = 24;
const MAX_SOLD_RESULTS = 24;

function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
}

function sendJson(res, status, payload) {
  setCors(res);
  return res.status(status).json(payload);
}

function cleanString(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function median(values = []) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

function percentile(values = [], p = 0.5) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const index = Math.min(nums.length - 1, Math.max(0, Math.round((nums.length - 1) * p)));
  return nums[index];
}

function parseShippingType(value = "") {
  const normalized = String(value).toLowerCase().trim();
  if (normalized === "buyer pays shipping") return "buyer_pays";
  if (normalized === "flat shipping") return "flat";
  return "free";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractItems(raw) {
  return raw?.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item || [];
}

function parseItem(item) {
  const title = cleanString(item?.title?.[0] || "");
  const itemId = item?.itemId?.[0] || "";
  const viewUrl = item?.viewItemURL?.[0] || "";
  const listingInfo = item?.listingInfo?.[0] || {};
  const sellingStatus = item?.sellingStatus?.[0] || {};
  const shippingInfo = item?.shippingInfo?.[0] || {};
  const condition = item?.condition?.[0]?.conditionDisplayName?.[0] || "";
  const image =
    item?.pictureURLLarge?.[0] ||
    item?.galleryPlusPictureURL?.[0] ||
    item?.galleryURL?.[0] ||
    "";

  const price = toNumber(sellingStatus?.currentPrice?.[0]?.__value__);
  const shipping = toNumber(shippingInfo?.shippingServiceCost?.[0]?.__value__);
  const total = price + shipping;

  return {
    itemId,
    title,
    url: viewUrl,
    image,
    condition,
    listingType: listingInfo?.listingType?.[0] || "",
    endTime: listingInfo?.endTime?.[0] || "",
    price: round2(price),
    shipping: round2(shipping),
    total: round2(total),
    location: item?.location?.[0] || "",
  };
}

function buildMarketSummary(items = []) {
  const prices = items.map((i) => i.price).filter((v) => v > 0);
  const totals = items.map((i) => i.total).filter((v) => v > 0);

  return {
    count: items.length,
    medianPrice: round2(median(prices)),
    medianTotal: round2(median(totals)),
    lowPrice: round2(percentile(prices, 0.1)),
    highPrice: round2(percentile(prices, 0.9)),
    lowTotal: round2(percentile(totals, 0.1)),
    highTotal: round2(percentile(totals, 0.9)),
  };
}

function computeFees({
  salePrice = 0,
  shippingCharged = 0,
  shippingCost = 0,
  feePercent = DEFAULT_FEE_PERCENT,
  orderFee = DEFAULT_ORDER_FEE,
}) {
  const grossCollected = salePrice + shippingCharged;
  const feeBase = grossCollected * feePercent + orderFee;
  return round2(Math.max(0, feeBase + shippingCost));
}

function buildResearchQuery({ query, size }) {
  return cleanString([query, size].filter(Boolean).join(" "));
}

function pickRecommendedPrice({ soldSummary, activeSummary, soldItems, activeItems }) {
  const soldMedian = soldSummary.medianPrice;
  const activeMedian = activeSummary.medianPrice;

  if (soldItems.length >= 5 && soldMedian > 0) return round2(soldMedian);
  if (soldItems.length >= 2 && soldMedian > 0 && activeMedian > 0) {
    return round2((soldMedian * 0.7) + (activeMedian * 0.3));
  }
  if (activeMedian > 0) return round2(activeMedian);
  return 0;
}

function scoreResearchQuality({ soldItems, activeItems, query }) {
  let score = 0;
  if (cleanString(query).length >= 8) score += 15;
  if (activeItems.length >= 5) score += 25;
  if (soldItems.length >= 3) score += 35;
  if (soldItems.length >= 8) score += 15;
  if (activeItems.length >= 10) score += 10;
  return Math.min(100, score);
}

function buildConfidenceLabel(score) {
  if (score >= 75) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

async function ebayFindItems({ appId, keywords, sold = false, entriesPerPage = 24 }) {
  const params = new URLSearchParams({
    "OPERATION-NAME": "findItemsAdvanced",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "true",
    keywords,
    "paginationInput.entriesPerPage": String(entriesPerPage),
    "outputSelector(0)": "PictureURLLarge",
    "outputSelector(1)": "GalleryInfo",
    "sortOrder": sold ? "EndTimeSoonest" : "BestMatch",
  });

  if (sold) {
    params.set("itemFilter(0).name", "SoldItemsOnly");
    params.set("itemFilter(0).value(0)", "true");
  } else {
    params.set("itemFilter(0).name", "HideDuplicateItems");
    params.set("itemFilter(0).value(0)", "true");
  }

  const response = await fetch(`${EBAY_FINDING_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      "X-EBAY-SOA-SECURITY-APPNAME": appId,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBay API error ${response.status}: ${text.slice(0, 300)}`);
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const appId = process.env.EBAY_APP_ID;
    if (!appId) {
      return sendJson(res, 500, { ok: false, error: "Missing EBAY_APP_ID" });
    }

    const input = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const query = cleanString(input.query || input.q || "");
    const size = cleanString(input.size || "");
    const buyCost = toNumber(input.buyCost, 0);
    const shippingType = parseShippingType(input.shippingType);
    const flatShippingCharge = toNumber(input.flatShippingCharge, 0);
    const shippingCost = toNumber(input.shippingCost, 0);
    const feePercent = toNumber(input.feePercent, DEFAULT_FEE_PERCENT);
    const orderFee = toNumber(input.orderFee, DEFAULT_ORDER_FEE);

    if (!query) {
      return sendJson(res, 400, { ok: false, error: "Missing query" });
    }

    const researchQuery = buildResearchQuery({ query, size });

    const [activeRaw, soldRaw] = await Promise.all([
      ebayFindItems({
        appId,
        keywords: researchQuery,
        sold: false,
        entriesPerPage: MAX_ACTIVE_RESULTS,
      }),
      ebayFindItems({
        appId,
        keywords: researchQuery,
        sold: true,
        entriesPerPage: MAX_SOLD_RESULTS,
      }),
    ]);

    const activeItems = safeArray(extractItems(activeRaw)).map(parseItem).filter((i) => i.price > 0);
    const soldItems = safeArray(extractItems(soldRaw)).map(parseItem).filter((i) => i.price > 0);

    const activeSummary = buildMarketSummary(activeItems);
    const soldSummary = buildMarketSummary(soldItems);

    const sellThroughRate = activeItems.length > 0
      ? round2((soldItems.length / activeItems.length) * 100)
      : 0;

    const recommendedPrice = pickRecommendedPrice({
      soldSummary,
      activeSummary,
      soldItems,
      activeItems,
    });

    let shippingCharged = 0;
    if (shippingType === "flat") shippingCharged = flatShippingCharge;
    if (shippingType === "buyer_pays") shippingCharged = shippingCost;

    const estimatedFees = computeFees({
      salePrice: recommendedPrice,
      shippingCharged,
      shippingCost,
      feePercent,
      orderFee,
    });

    const estimatedProfit = round2(
      recommendedPrice + shippingCharged - shippingCost - estimatedFees - buyCost
    );

    const roi = buyCost > 0 ? round2(estimatedProfit / buyCost) : 0;

    const researchScore = scoreResearchQuality({
      soldItems,
      activeItems,
      query: researchQuery,
    });

    return sendJson(res, 200, {
      ok: true,
      query: researchQuery,
      inputs: {
        buyCost: round2(buyCost),
        size,
        shippingType,
        flatShippingCharge: round2(flatShippingCharge),
        shippingCost: round2(shippingCost),
      },
      market: {
        sellThroughRate,
        researchScore,
        confidence: buildConfidenceLabel(researchScore),
        activeCount: activeItems.length,
        soldCount: soldItems.length,
        activePanel: {
          label: "Active Market",
          ...activeSummary,
          sample: activeItems.slice(0, 8),
        },
        soldPanel: {
          label: "Sold Market",
          ...soldSummary,
          sample: soldItems.slice(0, 8),
        },
      },
      pricing: {
        recommendedPrice: round2(recommendedPrice),
        medianActivePrice: round2(activeSummary.medianPrice),
        medianSoldPrice: round2(soldSummary.medianPrice),
        estimatedFees,
        estimatedProfit,
        roi,
      },
      topComps: {
        sold: soldItems.slice(0, 12),
        active: activeItems.slice(0, 12),
      },
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message || "Research failed",
    });
  }
}
