import vision from "@google-cloud/vision";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const RESELLER_BRANDS = [
  "lululemon", "athleta", "patagonia", "arc'teryx", "arcteryx", "the north face", "north face",
  "columbia", "peter millar", "vineyard vines", "brooks brothers", "tommy bahama",
  "travis mathew", "johnnie-o", "johnnie o", "robert graham", "untuckit", "orvis",
  "filson", "barbour", "carhartt", "pendleton", "woolrich", "ll bean", "l.l.bean",
  "eddie bauer", "ralph lauren", "polo ralph lauren", "lacoste", "burberry", "gucci",
  "coach", "tory burch", "free people", "anthropologie", "maeve", "eileen fisher",
  "j. jill", "talbots", "soft surroundings", "chico's", "madewell", "j. crew",
  "banana republic", "american eagle", "zara", "everlane", "reformation",
  "johnston & murphy", "allen edmonds", "cole haan", "birkenstock", "teva", "keen",
  "merrell", "salomon", "hoka", "brooks", "asics", "new balance", "nike", "adidas",
  "reebok", "under armour", "under armor", "champion", "spyder", "prana", "kuhl",
  "smartwool", "icebreaker", "levi's", "levis", "wrangler", "lee", "silver jeans",
  "ag", "paige", "hudson", "true religion", "miss me", "rock revival", "spanx",
  "victoria's secret", "pink", "vintage", "disney", "harley-davidson", "harley davidson",
  "st john", "vince", "theory", "rag & bone", "all saints", "allsaints"
];

const GARMENT_WORDS = [
  "shirt", "polo", "tee", "t-shirt", "tshirt", "sweater", "hoodie", "crewneck",
  "jacket", "coat", "vest", "blouse", "dress", "jeans", "pants", "shorts", "skirt",
  "leggings", "joggers", "pullover", "quarter zip", "1/4 zip", "full zip", "windbreaker",
  "fleece", "flannel", "button down", "henley", "tank", "cardigan", "scrub"
];

const SIZE_WORDS = [
  "xxs", "xs", "s", "small", "m", "medium", "l", "large", "xl", "xxl", "2xl", "3xl", "4xl", "5xl",
  "petite", "tall", "regular"
];

const NOISE_WORDS = [
  "rn", "ca", "www", "com", "made in", "machine wash", "polyester", "cotton", "spandex",
  "exclusive of decoration", "shell", "lining", "body", "trim", "care", "instructions",
  "dry clean", "wash cold", "imported"
];

function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
}

function sendJson(res, status, payload) {
  setCors(res);
  return res.status(status).json(payload);
}

function cleanString(value = "") {
  return String(value).replace(/[|]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(value = "") {
  return cleanString(value).toLowerCase();
}

function uniq(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

function createVisionClient() {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON");
  const credentials = JSON.parse(raw);
  return new vision.ImageAnnotatorClient({ credentials });
}

function extractTextLines(fullText = "") {
  return uniq(
    fullText
      .split("\n")
      .map(cleanString)
      .filter((line) => line.length >= 2)
      .filter((line) => !/^\d+$/.test(line))
  );
}

function scoreBrandMatch(ocrBlob, webBlob) {
  const combined = `${ocrBlob} ${webBlob}`.toLowerCase();
  const matches = [];

  for (const brand of RESELLER_BRANDS) {
    const needle = brand.toLowerCase();
    if (combined.includes(needle)) {
      let score = 65;
      if (ocrBlob.includes(needle)) score += 20;
      if (webBlob.includes(needle)) score += 10;
      if (needle.includes(" ")) score += 5;
      matches.push({ brand, score: Math.min(99, score) });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

function detectSize(lines = []) {
  const joined = normalizeText(lines.join(" "));
  const exact = ["xxs", "xs", "small", "medium", "large", "xl", "xxl", "2xl", "3xl", "4xl", "5xl", "petite", "tall"];

  for (const token of exact) {
    const regex = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (regex.test(joined)) {
      return token.toUpperCase().replace("SMALL", "S").replace("MEDIUM", "M").replace("LARGE", "L");
    }
  }

  const shorthand = joined.match(/\b(2xl|3xl|4xl|5xl|xxl|xl|xs|xxs|s|m|l)\b/i);
  return shorthand ? shorthand[1].toUpperCase() : "";
}

function detectGarmentType(lines = [], labels = []) {
  const blob = normalizeText([...lines, ...labels].join(" "));
  for (const word of GARMENT_WORDS) {
    if (blob.includes(word)) return word;
  }
  if (blob.includes("golf")) return "polo";
  if (blob.includes("outerwear")) return "jacket";
  return "";
}

function detectColor(labels = [], web = []) {
  const blob = normalizeText([...labels, ...web].join(" "));
  const colors = [
    "black", "white", "blue", "navy", "red", "green", "gray", "grey", "brown", "tan",
    "beige", "pink", "purple", "yellow", "orange", "teal", "gold", "silver", "burgundy"
  ];
  return colors.find((c) => blob.includes(c)) || "";
}

function removeNoise(line = "") {
  const text = cleanString(line);
  const lower = text.toLowerCase();

  if (text.length < 3) return "";
  if (NOISE_WORDS.some((word) => lower.includes(word))) return "";
  if (/^\d+%/.test(lower)) return "";
  if (/^[\d\s\-/:]+$/.test(lower)) return "";
  if (lower.includes("size") && text.length < 18) return "";
  if (lower.includes("style") && text.length < 18) return "";
  return text;
}

function extractCandidatePhrases(lines = []) {
  const candidates = [];
  for (const line of lines) {
    const cleaned = removeNoise(line);
    if (cleaned) candidates.push(cleaned);
  }
  return uniq(candidates).slice(0, 20);
}

function toTitleCase(value = "") {
  return cleanString(value)
    .split(" ")
    .map((word) => {
      if (!word) return word;
      if (word === word.toUpperCase() && word.length <= 4) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function cleanTitleChunk(chunk = "", brand = "") {
  let text = cleanString(chunk);
  if (!text) return "";
  const lower = text.toLowerCase();
  if (brand && lower === brand.toLowerCase()) return "";
  if (text.length > 70) text = text.slice(0, 70).trim();
  return toTitleCase(text);
}

function bestTitleFromSignals({ brand, garmentType, color, size, ocrCandidates, webEntities, labels }) {
  const titleParts = [];

  if (brand) titleParts.push(toTitleCase(brand));
  if (color) titleParts.push(toTitleCase(color));

  const bestPhrase =
    ocrCandidates.find((line) => {
      const lower = line.toLowerCase();
      return lower.length >= 6 &&
        !SIZE_WORDS.includes(lower) &&
        !NOISE_WORDS.some((w) => lower.includes(w));
    }) ||
    webEntities[0] ||
    labels[0] ||
    "";

  if (bestPhrase) {
    const cleanedPhrase = cleanTitleChunk(bestPhrase, brand);
    if (cleanedPhrase) titleParts.push(cleanedPhrase);
  }

  if (garmentType) {
    const gt = toTitleCase(garmentType);
    const combined = titleParts.join(" ").toLowerCase();
    if (!combined.includes(garmentType.toLowerCase())) titleParts.push(gt);
  }

  if (size) titleParts.push(size.toUpperCase());

  return cleanString(titleParts.join(" "));
}

function buildSearchQuery({ brand, title, garmentType, size }) {
  return cleanString([brand, title, garmentType, size].filter(Boolean).join(" "));
}

function buildConfidence({ brandMatches, textLines, labels, webEntities }) {
  let score = 20;
  if (brandMatches.length) score += 30;
  if (textLines.length >= 3) score += 20;
  if (labels.length >= 3) score += 15;
  if (webEntities.length >= 3) score += 15;
  return Math.min(99, score);
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
    const body = req.body || {};
    const imageBase64 = body.imageBase64 || body.image || "";
    const imageUrl = body.imageUrl || "";

    if (!imageBase64 && !imageUrl) {
      return sendJson(res, 400, { ok: false, error: "Missing imageBase64 or imageUrl" });
    }

    const client = createVisionClient();
    const image = imageBase64
      ? { content: imageBase64.replace(/^data:image\/\w+;base64,/, "") }
      : { source: { imageUri: imageUrl } };

    const [result] = await client.annotateImage({
      image,
      features: [
        { type: "TEXT_DETECTION", maxResults: 30 },
        { type: "LABEL_DETECTION", maxResults: 20 },
        { type: "WEB_DETECTION", maxResults: 15 },
        { type: "LOGO_DETECTION", maxResults: 10 },
        { type: "OBJECT_LOCALIZATION", maxResults: 10 },
      ],
    });

    const fullText = result?.fullTextAnnotation?.text || "";
    const textLines = extractTextLines(fullText);
    const labels = uniq((result?.labelAnnotations || []).map((x) => cleanString(x.description)).filter(Boolean));
    const webEntities = uniq((result?.webDetection?.webEntities || []).map((x) => cleanString(x.description)).filter(Boolean));
    const logos = uniq((result?.logoAnnotations || []).map((x) => cleanString(x.description)).filter(Boolean));
    const objects = uniq((result?.localizedObjectAnnotations || []).map((x) => cleanString(x.name)).filter(Boolean));

    const ocrBlob = normalizeText(textLines.join(" "));
    const webBlob = normalizeText([...webEntities, ...logos].join(" "));
    const brandMatches = scoreBrandMatch(ocrBlob, webBlob);

    const brand = brandMatches[0]?.brand
      ? toTitleCase(brandMatches[0].brand)
      : logos[0]
        ? toTitleCase(logos[0])
        : "";

    const size = detectSize(textLines);
    const garmentType = detectGarmentType(textLines, [...labels, ...objects, ...webEntities]);
    const color = detectColor(labels, webEntities);
    const ocrCandidates = extractCandidatePhrases(textLines);

    const suggestedTitle = bestTitleFromSignals({
      brand,
      garmentType,
      color,
      size,
      ocrCandidates,
      webEntities,
      labels,
    });

    const searchQuery = buildSearchQuery({
      brand,
      title: suggestedTitle,
      garmentType,
      size,
    });

    const confidence = buildConfidence({
      brandMatches,
      textLines,
      labels,
      webEntities,
    });

    return sendJson(res, 200, {
      ok: true,
      brand,
      size,
      garmentType,
      color,
      suggestedTitle,
      searchQuery,
      confidence,
      candidates: {
        titleCandidates: uniq([suggestedTitle, ...ocrCandidates.map(toTitleCase)]).slice(0, 8),
        brandMatches: brandMatches.slice(0, 8).map((x) => ({
          brand: toTitleCase(x.brand),
          score: x.score,
        })),
        labels: labels.slice(0, 12),
        webEntities: webEntities.slice(0, 12),
        logos: logos.slice(0, 8),
        objects: objects.slice(0, 8),
        textLines: textLines.slice(0, 20),
      },
      rawText: fullText,
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message || "Photo scan failed",
    });
  }
}
