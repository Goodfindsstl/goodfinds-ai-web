import { GoogleAuth } from "google-auth-library";

const VISION_URL = "https://vision.googleapis.com/v1/images:annotate";

function cleanText(text = "") {
  return text
    .replace(/\n/g, " ")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBrand(text) {
  const brands = [
    "nike", "adidas", "lululemon", "athleta", "under armour", "under armor",
    "ralph lauren", "polo", "travismathew", "tommy bahama", "callaway",
    "footjoy", "vineyard vines", "brooks brothers", "patagonia", "columbia",
    "vuori", "alo", "fabletics", "levis", "levi's"
  ];

  const lower = text.toLowerCase();
  return brands.find(b => lower.includes(b)) || "";
}

function pickSize(text) {
  const matches = text.match(/\b(xs|s|m|l|xl|xxl|2x|3x|4x|small|medium|large)\b/i);
  return matches ? matches[0].toUpperCase() : "";
}

function pickGarment(text) {
  const types = [
    "golf polo", "polo shirt", "polo", "hoodie", "jacket", "quarter zip",
    "zip pullover", "shirt", "dress", "skirt", "leggings", "jeans", "shorts",
    "sweater", "blouse", "tank"
  ];
  const lower = text.toLowerCase();
  return types.find(t => lower.includes(t)) || "";
}

async function getGoogleAccessToken() {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON");

  const credentials = JSON.parse(raw);
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse?.token) throw new Error("Failed to get Google access token");
  return tokenResponse.token;
}

async function annotateImage(imageBase64) {
  const token = await getGoogleAccessToken();

  const body = {
    requests: [
      {
        image: { content: imageBase64 },
        features: [
          { type: "TEXT_DETECTION", maxResults: 10 },
          { type: "LABEL_DETECTION", maxResults: 10 },
          { type: "LOGO_DETECTION", maxResults: 5 }
        ]
      }
    ]
  };

  const res = await fetch(VISION_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vision API error: ${text}`);
  }

  return await res.json();
}

function buildBestMatchTitle(data, mode = "item") {
  const r = data?.responses?.[0] || {};
  const ocrText = cleanText(r?.fullTextAnnotation?.text || r?.textAnnotations?.[0]?.description || "");
  const labels = (r?.labelAnnotations || []).map(x => x.description);
  const logos = (r?.logoAnnotations || []).map(x => x.description);

  const merged = cleanText([ocrText, ...labels, ...logos].join(" "));
  const brand = pickBrand(merged);
  const size = pickSize(merged);
  const garment = pickGarment(merged);

  if (mode === "tag") {
    return cleanText([brand, garment || "top", size].filter(Boolean).join(" "));
  }

  return cleanText([
    brand,
    garment || labels[0] || "clothing item",
    size
  ].filter(Boolean).join(" "));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { imageBase64, mode = "item" } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    const data = await annotateImage(imageBase64);
    const bestMatchTitle = buildBestMatchTitle(data, mode);

    return res.status(200).json({
      ok: true,
      bestMatchTitle,
      raw: {
        labels: data?.responses?.[0]?.labelAnnotations?.map(x => x.description) || [],
        logos: data?.responses?.[0]?.logoAnnotations?.map(x => x.description) || []
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "Server error"
    });
  }
}
