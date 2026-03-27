async function extractLikelyBarcodeText(imageBase64) {
  const body = {
    requests: [
      {
        image: { content: imageBase64 },
        features: [{ type: "TEXT_DETECTION", maxResults: 10 }]
      }
    ]
  };

  const rawCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!rawCreds) {
    throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON");
  }

  const { GoogleAuth } = await import("google-auth-library");

  const auth = new GoogleAuth({
    credentials: JSON.parse(rawCreds),
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse?.token;

  if (!token) {
    throw new Error("Failed to get Google access token");
  }

  const visionRes = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!visionRes.ok) {
    const text = await visionRes.text();
    throw new Error(`Vision API error: ${text}`);
  }

  const data = await visionRes.json();

  const text =
    data?.responses?.[0]?.fullTextAnnotation?.text ||
    data?.responses?.[0]?.textAnnotations?.[0]?.description ||
    "";

  const digits = (text.match(/\b\d{12,14}\b/g) || [])[0] || "";
  return digits;
}

async function lookupUpc(upc) {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`;

  const res = await fetch(url, {
    method: "GET"
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`UPC lookup error: ${text}`);
  }

  return await res.json();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { imageBase64 } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    const upc = await extractLikelyBarcodeText(imageBase64);

    if (!upc) {
      return res.status(200).json({
        ok: true,
        upc: "",
        title: "",
        query: "",
        bestMatchTitle: "",
        brand: "",
        description: "",
        category: ""
      });
    }

    const lookup = await lookupUpc(upc);
    const item = lookup?.items?.[0] || {};
    const title = item.title || "";

    return res.status(200).json({
      ok: true,
      upc,
      title,
      query: title || upc,
      bestMatchTitle: title || upc,
      brand: item.brand || "",
      description: item.description || "",
      category: item.category || ""
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "Server error"
    });
  }
}
