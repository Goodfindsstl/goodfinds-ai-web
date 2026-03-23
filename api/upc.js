const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

function send(res, status, data) {
  setCors(res);
  return res.status(status).json(data);
}

function clean(v = "") {
  return String(v).trim();
}

function normalizeUPC(v = "") {
  return String(v).replace(/\D/g, "");
}

function buildSearchQuery(item) {
  return [item.brand, item.title, item.category].filter(Boolean).join(" ");
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const input = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const raw = input.upc || input.code || input.barcode || "";
    const upc = normalizeUPC(raw);

    if (!upc) {
      return send(res, 400, { ok: false, error: "Missing UPC" });
    }

    const response = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`
    );

    const data = await response.json();

    if (!data.items || !data.items.length) {
      return send(res, 404, {
        ok: false,
        error: "No product found",
        upc,
      });
    }

    const item = data.items[0];

    const product = {
      upc,
      title: clean(item.title),
      brand: clean(item.brand),
      category: clean(item.category),
      image: item.images?.[0] || "",
      offers: (item.offers || []).slice(0, 5).map((o) => ({
        merchant: o.merchant,
        price: Number(o.price || 0),
        condition: o.condition,
        link: o.link,
      })),
    };

    return send(res, 200, {
      ok: true,
      upc,
      product,
      searchQuery: buildSearchQuery(product),
    });
  } catch (err) {
    return send(res, 500, {
      ok: false,
      error: err.message || "UPC lookup failed",
    });
  }
}
