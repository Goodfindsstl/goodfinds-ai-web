const EBAY_OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function normalizeTitle(s = "") {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(nwt|nwot|euc|new|used|shirt|top)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a, b) {
  const as = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const bs = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (!as.size || !bs.size) return 0;
  let common = 0;
  for (const token of as) if (bs.has(token)) common++;
  return common / Math.max(as.size, bs.size);
}

function parsePrice(item) {
  const raw = item?.price?.value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseShipping(item) {
  const raw =
    item?.shippingOptions?.[0]?.shippingCost?.value ??
    item?.shippingOptions?.[0]?.shippingCostType === "FIXED"
      ? item?.shippingOptions?.[0]?.shippingCost?.value
      : null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function getEbayToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });

  const res = await fetch(EBAY_OAUTH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token error: ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function searchEbay({ query, limit = 50 }) {
  const token = await getEbayToken();

  const url = new URL(EBAY_BROWSE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE|AUCTION}");
  url.searchParams.set("sort", "price");

  const res = await fetch(url.toString(), {
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay search error: ${text}`);
  }

  return await res.json();
}

function buildDecision({
  query,
  items,
  buyCost,
  shippingMode,
  flatShipping,
  sizeValue
}) {
  const filtered = (items || [])
    .map(item => ({
      title: item.title || "",
      price: parsePrice(item),
      shipping: parseShipping(item),
      url: item.itemWebUrl || ""
    }))
    .filter(x => x.price !== null)
    .filter(x => titleSimilarity(query, x.title) >= 0.25);

  const usable = filtered.length ? filtered : (items || [])
    .map(item => ({
      title: item.title || "",
      price: parsePrice(item),
      shipping: parseShipping(item),
      url: item.itemWebUrl || ""
    }))
    .filter(x => x.price !== null);

  if (!usable.length) {
    return {
      verdict: "PASS",
      confidence: 35,
      resellerScore: 22,
      demandScore: 20,
      medianPrice: 0,
      recommendedPrice: 0,
      projectedProfit: -buyCost,
      roi: -100,
      listingTier: "FAST",
      estimatedListTime: "45 sec",
      why: [
        "No strong live marketplace match found",
        "Too little pricing confidence",
        "Skip unless this is a known personal bolo"
      ],
      photoPlan: ["Front", "Back", "Tag"],
      queryUsed: query
    };
  }

  const prices = usable.map(x => x.price);
  const shipCosts = usable.map(x => x.shipping);
  const medianPrice = median(prices);
  const avgShipping = avg(shipCosts);

  const p25 = percentile(prices, 25);
  const p75 = percentile(prices, 75);
  const spread = Math.max(1, p75 - p25);

  const recommendedPrice = Math.max(
    8.99,
    Number((medianPrice * 0.94).toFixed(2))
  );

  const finalShippingCost =
    shippingMode === "buyer_pays" ? 0 :
    shippingMode === "flat" ? Number(flatShipping || 0) :
    avgShipping;

  const ebayFee = recommendedPrice * 0.13;
  const projectedProfit = Number((
    recommendedPrice - ebayFee - finalShippingCost - Number(buyCost || 0)
  ).toFixed(2));

  const roi = buyCost > 0
    ? Number(((projectedProfit / buyCost) * 100).toFixed(0))
    : 0;

  const matchStrength = Math.min(100, Math.round((usable.length / Math.max(10, items.length || 1)) * 100));
  const priceConsistency = Math.max(0, Math.min(100, Math.round(100 - (spread / Math.max(1, medianPrice)) * 100)));
  const demandScore = Math.round((matchStrength * 0.55) + (priceConsistency * 0.45));
  const profitScore = Math.max(0, Math.min(100, Math.round(((projectedProfit + 5) / 35) * 100)));
  const easeScore = medianPrice >= 45 ? 70 : 92;

  const resellerScore = Math.round(
    (demandScore * 0.42) +
    (profitScore * 0.38) +
    (easeScore * 0.20)
  );

  let verdict = "HOLD";
  if (resellerScore >= 78 && projectedProfit >= 12) verdict = "BUY";
  else if (resellerScore < 50 || projectedProfit < 6) verdict = "PASS";

  let listingTier = "FAST";
  let estimatedListTime = "45 sec";
  let photoPlan = ["Front", "Back", "Tag"];

  if (medianPrice >= 35 && medianPrice < 65) {
    listingTier = "STANDARD";
    estimatedListTime = "2-3 min";
    photoPlan = ["Front", "Back", "Tag", "Logo detail", "Fabric close-up"];
  } else if (medianPrice >= 65) {
    listingTier = "PREMIUM";
    estimatedListTime = "5-7 min";
    photoPlan = ["Front", "Back", "Tag", "Logo detail", "Measurements", "Any flaws"];
  }

  const why = [
    `Matched ${usable.length} live eBay listings`,
    `Median active price is $${medianPrice.toFixed(2)}`,
    `Projected profit is $${projectedProfit.toFixed(2)}`,
    sizeValue ? `Size filter noted: ${sizeValue}` : "No size filter applied"
  ];

  return {
    verdict,
    confidence: Math.max(45, Math.min(96, resellerScore)),
    resellerScore,
    demandScore,
    medianPrice: Number(medianPrice.toFixed(2)),
    recommendedPrice,
    projectedProfit,
    roi,
    listingTier,
    estimatedListTime,
    why,
    photoPlan,
    queryUsed: query,
    activeCount: items.length
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const {
      query,
      buyCost = 0,
      shippingMode = "buyer_pays",
      flatShipping = 0,
      sizeValue = ""
    } = req.body || {};

    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: "Missing query" });
    }

    const search = await searchEbay({ query: String(query).trim(), limit: 50 });
    const items = search.itemSummaries || [];

    const decision = buildDecision({
      query: String(query).trim(),
      items,
      buyCost: Number(buyCost || 0),
      shippingMode,
      flatShipping: Number(flatShipping || 0),
      sizeValue
    });

    return res.status(200).json({
      ok: true,
      ...decision
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "Server error"
    });
  }
}
