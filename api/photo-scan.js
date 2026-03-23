const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_IMAGE_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search_by_image";
const DEFAULT_MARKETPLACE = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

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

  return {
    itemId: item?.itemId || "",
    legacyItemId: item?.legacyItemId || "",
    title: cleanString(item?.title || ""),
    url: item?.itemWebUrl || "",
    image,
    condition: item?.condition || "",
    price: round2(price),
    shipping: round2(shipping),
    total: round2(price + shipping),
    seller: item?.seller?.username || "",
    category: item?.categories?.[0]?.categoryName || "",
  };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, mimeType } = req.body || {};

    if (!imageBase64) {
      return sendJson(res, 400, { ok: false, error: "Missing imageBase64" });
    }

    const accessToken = await getEbayAccessToken();

    const url = new URL(EBAY_IMAGE_SEARCH_URL);
    url.searchParams.set("limit", "18");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": DEFAULT_MARKETPLACE,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: imageBase64,
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        data?.errors?.[0]?.message ||
        data?.errors?.[0]?.longMessage ||
        `eBay image search HTTP ${response.status}`;
      throw new Error(message);
    }

    const items = (data?.itemSummaries || []).map(parseBrowseItem);

    return sendJson(res, 200, {
      ok: true,
      source: "ebay_browse_image_search",
      mimeType: mimeType || "image/jpeg",
      results: items,
      total: data?.total || items.length,
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error?.message || "Photo scan failed",
    });
  }
}
