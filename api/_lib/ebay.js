const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const IMAGE_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search_by_image";

let cachedToken = null;
let cachedExpiry = 0;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function median(values = []) {
  const nums = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

async function getAppToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiry - 60000) return cachedToken;

  const clientId = requireEnv("EBAY_CLIENT_ID");
  const clientSecret = requireEnv("EBAY_CLIENT_SECRET");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description || "Failed to get eBay token");
  }

  cachedToken = data.access_token;
  cachedExpiry = now + Number(data.expires_in || 7200) * 1000;
  return cachedToken;
}

async function ebayFetch(url, options = {}) {
  const token = await getAppToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID || "EBAY_US",
      ...(options.headers || {})
    }
  });

  const data = await res.json();
  if (!res.ok) {
    const message = data?.errors?.[0]?.message || data?.message || "eBay request failed";
    throw new Error(message);
  }
  return data;
}

function normalizeItems(items = []) {
  return items
    .map(item => ({
      title: String(item?.title || "").trim(),
      price: Number(item?.price?.value || 0),
      image: item?.image?.imageUrl || "",
      condition: item?.condition || "",
      category: item?.categories?.[0]?.categoryName || ""
    }))
    .filter(item => item.title && item.price > 0);
}

export async function searchByKeywords(query, limit = 24) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  const data = await ebayFetch(url.toString());
  return normalizeItems(data?.itemSummaries || []);
}

export async function searchByGtin(gtin, limit = 24) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("gtin", gtin);
  url.searchParams.set("limit", String(limit));
  const data = await ebayFetch(url.toString());
  return normalizeItems(data?.itemSummaries || []);
}

export async function searchByImage(base64Image) {
  const data = await ebayFetch(IMAGE_SEARCH_URL, {
    method: "POST",
    body: JSON.stringify({ image: base64Image })
  });
  return normalizeItems(data?.itemSummaries || []);
}

export function summarizeItems(items = []) {
  const prices = items.map(item => item.price).filter(v => v > 0);
  return {
    count: items.length,
    medianPrice: roundMoney(median(prices)),
    lowPrice: roundMoney(prices.length ? Math.min(...prices) : 0),
    highPrice: roundMoney(prices.length ? Math.max(...prices) : 0),
    cleanedTitle: items[0]?.title || "",
    category: items[0]?.category || ""
  };
}
