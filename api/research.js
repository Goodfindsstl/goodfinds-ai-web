const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

const DEFAULT_MARKETPLACE = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
const DEFAULT_FEE_PERCENT = 0.1325;
const DEFAULT_ORDER_FEE = 0.3;

let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
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
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

function percentile(values = [], p = 0.5) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
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

function buildResearchQuery({ query, size }) {
  return cleanString([query, size].filter(Boolean).join(" "));
}

async function getEbayAccessToken() {
  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });

  const response = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Failed to get eBay access token");
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + ((data.expires_in || 7200) - 120) * 1000,
  };

  return tokenCache.accessToken;
}

function parseBrowseItem(item = {}) {
  const image =
    item?.image?.imageUrl ||
    item?.thumbnailImages?.[0]?.imageUrl ||
    item?.additionalImages?.[0]?.imageUrl ||
    "";

  const price = toNumber(item?.price?.value, 0);
  const shipping = toNumber(item?.shippingOptions?.[0]?.shippingCost?.value, 0);
  const total = price + shipping;

  return {
    itemId: item?.itemId || "",
    legacyItemId: item?.legacyItemId || "",
    title: cleanString(item?.title || ""),
    url: item?.itemWebUrl || "",
    image,
    condition: item?.condition || "",
    price: round2(price),
    shipping: round2(shipping),
    total: round2(total),
    seller: item?.seller?.username || "",
    category: item?.categories?.[0]?.categoryName || "",
    buyingOptions: item?.buyingOptions || [],
    itemEndDate: item?.itemEndDate || "",
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

function scoreResearchQuality({ items, query }) {
  let score = 0;
  if (cleanString(query).length >= 8) score += 20;
  if (items.length >= 5) score += 35;
  if (items.length >= 12) score += 25;
  if (items.length >= 24) score += 20;
  return Math.min(100, score);
}

function buildConfidenceLabel(score) {
  if (score >= 75) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

function buildDemandLabel(count) {
  if (count >= 30) return "Very strong";
  if (count >= 18) return "Strong";
  if (count >= 8) return "Moderate";
  return "Thin";
}

async function browseSearch({ accessToken, query, limit = 24 }) {
  const url = new URL(EBAY_BROWSE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-EBAY-C-MARKETPLACE-ID": DEFAULT_MARKETPLACE,
      Accept: "application/json",
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data?.errors?.[0]?.message ||
      data?.errors?.[0]?.longMessage ||
      `eBay Browse HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
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
    const accessToken = await getEbayAccessToken();
    const raw = await browseSearch({
      accessToken,
      query: researchQuery,
      limit: 24,
    });

    const items = (raw?.itemSummaries || [])
      .map(parseBrowseItem)
      .filter((i) => i.price > 0);

    const summary = buildMarketSummary(items);
    const recommendedPrice = summary.medianPrice || 0;

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
    const researchScore = scoreResearchQuality({ items, query: researchQuery });

    return sendJson(res, 200, {
      ok: true,
      source: "ebay_browse",
      query: researchQuery,
      note: "Live active-market research from eBay Browse API.",
      inputs: {
        buyCost: round2(buyCost),
        size,
        shippingType,
        flatShippingCharge: round2(flatShippingCharge),
        shippingCost: round2(shippingCost),
      },
      market: {
        activeCount: items.length,
        demand: buildDemandLabel(items.length),
        researchScore,
        confidence: buildConfidenceLabel(researchScore),
        activePanel: {
          label: "Active Market",
          ...summary,
          sample: items.slice(0, 8),
        },
      },
      pricing: {
        recommendedPrice: round2(recommendedPrice),
        medianActivePrice: round2(summary.medianPrice),
        estimatedFees,
        estimatedProfit,
        roi,
      },
      topComps: {
        active: items.slice(0, 12),
      },
      rawCountEstimate: raw?.total || items.length,
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error?.message || "Research failed",
    });
  }
}
