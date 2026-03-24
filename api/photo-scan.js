const BRAND_DICTIONARY = [
  "athleta",
  "nike",
  "under armour",
  "underarmour",
  "adidas",
  "lululemon",
  "travis mathew",
  "travismathew",
  "ralph lauren",
  "polo ralph lauren",
  "tommy bahama",
  "vineyard vines",
  "brooks brothers",
  "patagonia",
  "columbia",
  "the north face",
  "callaway",
  "footjoy",
  "peter millar",
  "johnnie-o",
  "mizzen and main",
  "mizzen+main",
  "free people",
  "anthropologie",
  "madewell",
  "j crew",
  "j.crew",
  "banana republic",
  "talbots",
  "chicos",
  "chico's",
  "cabi",
  "eileen fisher",
  "lilly pulitzer",
  "boss",
  "hugo boss",
  "puma",
  "reebok",
  "fila",
  "lacoste"
];

const CLOTHING_WORDS = [
  "shirt",
  "polo",
  "jacket",
  "hoodie",
  "sweatshirt",
  "sweater",
  "jeans",
  "pants",
  "leggings",
  "dress",
  "blouse",
  "shorts",
  "skirt",
  "top",
  "tee",
  "t-shirt",
  "quarter zip",
  "1/4 zip",
  "full zip",
  "pullover",
  "tank",
  "vest",
  "cardigan",
  "golf",
  "activewear",
  "athletic",
  "button front",
  "button down"
];

const SIZE_WORDS = [
  "xxs",
  "xs",
  "s",
  "small",
  "m",
  "medium",
  "l",
  "large",
  "xl",
  "xxl",
  "2xl",
  "3xl",
  "4xl",
  "petite",
  "tall",
  "plus",
  "0",
  "2",
  "4",
  "6",
  "8",
  "10",
  "12",
  "14",
  "16",
  "18",
  "20"
];

const JUNK_WORDS = [
  "rn",
  "ca",
  "shell",
  "lining",
  "exclusive of decoration",
  "machine wash",
  "polyester",
  "spandex",
  "cotton",
  "rayon",
  "nylon",
  "elastane",
  "made in",
  "see reverse",
  "registered identification number"
];

function normalizeText(text = "") {
  return String(text)
    .replace(/[®™©]/g, " ")
    .replace(/[_|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(text = "") {
  return normalizeText(text).toLowerCase();
}

function titleCase(input = "") {
  return String(input)
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/^\d+[xXlL]*$/.test(word)) return word.toUpperCase();
      if (word.length <= 2) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function uniq(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

function extractUPC(text = "") {
  const matches = String(text).match(/\b\d{12,14}\b/g) || [];
  return matches[0] || null;
}

function extractBrand(text = "") {
  const lc = compact(text);
  const sortedBrands = [...BRAND_DICTIONARY].sort((a, b) => b.length - a.length);

  for (const brand of sortedBrands) {
    if (lc.includes(brand)) {
      const cleaned = brand === "underarmour" ? "under armour" : brand;
      return titleCase(cleaned);
    }
  }
  return null;
}

function extractSize(text = "") {
  const lc = compact(text);

  for (const size of SIZE_WORDS) {
    const escaped = size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(lc)) return size.toUpperCase();
  }

  return null;
}

function detectMode({ text = "", requestedMode = "" }) {
  if (["tag", "item", "upc"].includes(requestedMode)) return requestedMode;

  const lc = compact(text);
  const upc = extractUPC(lc);
  if (upc) return "upc";

  const tagSignals = ["size", "rn", "ca", "shell", "lining", "made in", "fabric", "care"];
  const itemSignals = CLOTHING_WORDS;

  const tagHits = tagSignals.filter((x) => lc.includes(x)).length;
  const itemHits = itemSignals.filter((x) => lc.includes(x)).length;

  if (tagHits >= 2) return "tag";
  if (itemHits >= 1) return "item";
  return "item";
}

function filterUsefulLines(lines = []) {
  return lines
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter((line) => line.length >= 2)
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !JUNK_WORDS.some((junk) => compact(line).includes(junk)));
}

function buildCandidates(lines = [], fullText = "") {
  const candidates = new Set();

  for (const line of lines) {
    candidates.add(line);
  }

  const tokens = normalizeText(fullText).split(/\s+/).filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    for (let len = 2; len <= 8; len++) {
      const gram = tokens.slice(i, i + len).join(" ");
      if (gram.length >= 8) candidates.add(gram);
    }
  }

  return [...candidates]
    .map((x) => normalizeText(x))
    .filter((x) => x.length >= 4 && x.length <= 80);
}

function scoreCandidate(candidate, context) {
  const lc = compact(candidate);
  if (!lc) return -999;

  let score = 0;

  if (context.brand && lc.includes(compact(context.brand))) score += 40;
  if (context.size && new RegExp(`\\b${context.size.toLowerCase()}\\b`, "i").test(lc)) score += 10;

  const clothingHits = CLOTHING_WORDS.filter((word) => lc.includes(word)).length;
  score += clothingHits * 12;

  const junkHits = JUNK_WORDS.filter((word) => lc.includes(word)).length;
  score -= junkHits * 15;

  if (/\b(size|rn|ca|shell|lining|fabric|made in)\b/i.test(lc)) score -= 15;
  if (/^\d+$/.test(lc)) score -= 20;
  if (candidate.length > 65) score -= 10;
  if (candidate.split(" ").length > 10) score -= 10;

  if (/men|mens|women|womens|ladies/.test(lc)) score += 4;
  if (/golf|quarter zip|1\/4 zip|polo|hoodie|jacket|leggings|shorts|dress|jeans/.test(lc)) score += 8;

  return score;
}

function buildCleanTitle({ brand, size, bestCandidate, fullText }) {
  const lc = compact(`${bestCandidate} ${fullText}`);

  let itemType = CLOTHING_WORDS.find((word) => lc.includes(word)) || "";
  if (itemType === "t-shirt") itemType = "T Shirt";
  else if (itemType) itemType = titleCase(itemType);

  const gender =
    /\bwomen|womens|ladies\b/.test(lc)
      ? "Women"
      : /\bmen|mens\b/.test(lc)
      ? "Men"
      : "";

  const parts = [brand, gender, itemType, size].filter(Boolean);

  if (parts.length >= 2) {
    return uniq(parts).join(" ");
  }

  return titleCase(bestCandidate || brand || "Unknown Item");
}

async function imageUrlToBase64(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error("Failed to download imageUrl");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}

async function visionDetectText(base64Image) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GOOGLE_VISION_API_KEY");
  }

  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64Image },
          features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
          imageContext: {
            languageHints: ["en"],
          },
        },
      ],
    }),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json?.error?.message || "Vision OCR failed");
  }

  return json?.responses?.[0]?.fullTextAnnotation?.text || "";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { imageBase64, imageUrl, scanMode } = req.body || {};

    if (!imageBase64 && !imageUrl) {
      return res.status(400).json({
        ok: false,
        error: "Provide imageBase64 or imageUrl",
      });
    }

    const base64 = imageBase64 || (await imageUrlToBase64(imageUrl));
    const rawText = normalizeText(await visionDetectText(base64));
    const lines = filterUsefulLines(rawText.split(/\n+/));
    const mode = detectMode({ text: rawText, requestedMode: scanMode });

    const upc = extractUPC(rawText);
    const brand = extractBrand(rawText);
    const size = extractSize(rawText);

    if (mode === "upc" && upc) {
      return res.status(200).json({
        ok: true,
        scanMode: "upc",
        bestMatchTitle: upc,
        cleanTitle: upc,
        confidenceScore: 0.99,
        extracted: {
          upc,
          brand,
          size,
        },
        tokens: uniq(rawText.toLowerCase().split(/\W+/).filter((x) => x.length > 2)).slice(0, 40),
        rawText,
      });
    }

    const candidates = buildCandidates(lines, rawText);
    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: scoreCandidate(candidate, { brand, size, mode }),
      }))
      .sort((a, b) => b.score - a.score);

    const bestCandidate = scored[0]?.candidate || brand || "";
    const topScore = scored[0]?.score ?? 0;
    const confidenceScore = Math.max(
      0.2,
      Math.min(0.99, Number(((topScore + 20) / 100).toFixed(2)))
    );

    const cleanTitle = buildCleanTitle({
      brand,
      size,
      bestCandidate,
      fullText: rawText,
    });

    return res.status(200).json({
      ok: true,
      scanMode: mode,
      bestMatchTitle: cleanTitle,
      cleanTitle,
      confidenceScore,
      extracted: {
        upc,
        brand,
        size,
      },
      tokens: uniq(rawText.toLowerCase().split(/\W+/).filter((x) => x.length > 2)).slice(0, 60),
      rankedCandidates: scored.slice(0, 8),
      rawText,
      fallbackUsed: confidenceScore < 0.55,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "photo-scan failed",
    });
  }
}
