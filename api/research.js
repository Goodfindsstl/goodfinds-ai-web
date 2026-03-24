import { runPricingEngine } from "../lib/pricing-engine";

const EBAY_OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_FINDING_URL = "https://svcs.ebay.com/services/search/FindingService/v1";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanQuery(query = "") {
  return String(query)
    .replace(/[^\w\s\-+&/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(title = "") {
  return cleanQuery(title).toLowerCase();
}

function scoreComparable(itemTitle, queryTitle) {
  const a = new Set(normalizeTitle(itemTitle).split(" ").filter(Boolean));
  const b = new Set(normalizeTitle(queryTitle).split(" ").filter(Boolean));

  if (!a.size || !b.size) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap++;
  }

  return overlap / Math.max(1, b.size);
}

function filterRelevant(items = [], queryTitle = "", minScore = 0.25) {
  return items.filter((item) => scoreComparable(item.title || "", queryTitle) >= minScore);
}

function dedupeByTitleAndPrice(items = []) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const key = `${normalizeTitle(item.title || "")}|${Number(item.price || 0).toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function sortByBestComparable(items = [], queryTitle = "") {
  return [...items].sort(
    (a, b) => scoreComparable(b.title || "", queryTitle) - scoreComparable(a.title || "", queryTitle)
  );
}

async function getEbayToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(EBAY_OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json?.error_description || json?.error || "Failed to get eBay token");
  }

  return json.access_token;
}

async function fetchActiveBrowse({ query, limit = 50, categoryIds = "" }) {
  const token = await getEbayToken();
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(limit, 200)),
    sort: "price",
    filter: "buyingOptions:{FIXED_PRICE}",
  });

  if (categoryIds) {
    params.set("category_ids", categoryIds);
  }

  const response = await fetch(`${EBAY_BROWSE_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      Accept: "application/json",
    },
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json?.errors?.[0]?.message || "Browse active search failed");
  }

  const items = json?.itemSummaries || [];

  return items.map((item) => ({
    itemId: item.itemId || "",
    title: item.title || "",
    price: Number(item.price?.value || 0),
    currency: item.price?.currency || "USD",
    condition: item.condition || "",
    itemWebUrl: item.itemWebUrl || "",
    imageUrl: item.image?.imageUrl || "",
    shippingPrice: Number(item.shippingOptions?.[0]?.shippingCost?.value || 0),
    buyingOptions: item.buyingOptions || [],
    seller: item.seller?.username || "",
    source: "browse_active",
  }));
}

async function fetchSoldCompleted({ query, limit = 50, categoryId = "" }) {
  const appId = process.env.EBAY_APP_ID || process.env.EBAY_CLIENT_ID;

  if (!appId) {
    throw new Error("Missing EBAY_APP_ID or EBAY_CLIENT_ID");
  }

  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "true",
    keywords: query,
    "paginationInput.entriesPerPage": String(Math.min(limit, 100)),
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
    "itemFilter(1).name": "ListingType",
    "itemFilter(1).value(0)": "FixedPrice",
    sortOrder: "EndTimeSoonest",
  });

  if (categoryId) {
    params.set("categoryId", categoryId);
  }

  const response = await fetch(`${EBAY_FINDING_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  const json = await response.json();
  const items = json?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

  return items.map((item) => ({
    itemId: item.itemId?.[0] || "",
    title: item.title?.[0] || "",
    price: Number(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0),
    currency: item.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"] || "USD",
    condition: item.condition?.[0]?.conditionDisplayName?.[0] || "",
    itemWebUrl: item.viewItemURL?.[0] || "",
    imageUrl: item.galleryURL?.[0] || "",
    shippingPrice: Number(item.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__ || 0),
    source: "finding_sold",
  }));
}

function extractCategoryHint(title = "") {
  const lc = String(title).toLowerCase();

  if (/dress|blouse|skirt|women|womens|ladies/.test(lc)) return "15724";
  if (/shirt|polo|hoodie|sweatshirt|jacket|men|mens|golf/.test(lc)) return "1059";

  return "";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const {
      query,
      title,
      buyCost = 0,
      shippingCost = 0,
      buyerPaysShipping = true,
      categoryId,
      limit = 50,
    } = req.body || {};

    const inputTitle = cleanQuery(query || title || "");

    if (!inputTitle) {
      return res.status(400).json({
        ok: false,
        error: "Missing query or title",
      });
    }

    const derivedCategoryId = categoryId || extractCategoryHint(inputTitle);

    const [activeRaw, soldRaw] = await Promise.all([
      fetchActiveBrowse({
        query: inputTitle,
        limit,
        categoryIds: derivedCategoryId,
      }),
      fetchSoldCompleted({
        query: inputTitle,
        limit,
        categoryId: derivedCategoryId,
      }),
    ]);

    const activeRelevant = dedupeByTitleAndPrice(
      sortByBestComparable(filterRelevant(activeRaw, inputTitle, 0.25), inputTitle)
    );

    const soldRelevant = dedupeByTitleAndPrice(
      sortByBestComparable(filterRelevant(soldRaw, inputTitle, 0.25), inputTitle)
    );

    const pricingEngine = runPricingEngine({
      title: inputTitle,
      activeComps: activeRelevant,
      soldComps: soldRelevant,
      buyCost: toNumber(buyCost),
      shippingCost: toNumber(shippingCost),
      buyerPaysShipping: Boolean(buyerPaysShipping),
    });

    return res.status(200).json({
      ok: true,
      query: inputTitle,
      categoryIdUsed: derivedCategoryId || null,
      counts: {
        active: activeRelevant.length,
        sold: soldRelevant.length,
      },
      verdict: pricingEngine.verdict,
      sellThrough: pricingEngine.sellThrough,
      compStats: pricingEngine.compStats,
      economics: pricingEngine.economics,
      pricing: pricingEngine.pricing,
      topComps: {
        active: activeRelevant.slice(0, 12),
        sold: soldRelevant.slice(0, 12),
      },
      rawComps: {
        active: activeRelevant,
        sold: soldRelevant,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "research failed",
    });
  }
}
