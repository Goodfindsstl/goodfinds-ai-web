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
