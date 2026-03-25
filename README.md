# GoodFinds AI Starter Pack

Built by resellers, for resellers.

This starter pack includes:
- Vercel backend for live product research
- Web frontend (`index.html`)
- Squarespace embed version
- Expo app shell
- Clean SVG logo files

## Folder Structure

```text
api/
  _lib/ebay.js
  research.js
lib/
  pricing-engine.js
squarespace/
  scanner-embed.html
app/
  App.js
  app.json
  package.json
assets/
  logo-light.svg
  logo-dark.svg
  app-icon.svg
index.html
vercel.json
.gitignore
```

## Vercel Environment Variables

Add these in Vercel:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_MARKETPLACE_ID=EBAY_US`

## What Works Now

- Photo, tag, and UPC research flow
- eBay Browse API live search structure
- Pricing / ROI / BUY-HOLD-PASS logic
- Website layout with pricing plans
- Squarespace-ready embed
- Expo wrapper app

## What You Still Need To Do

- Replace all placeholder URLs
- Add your real eBay credentials in Vercel
- Paste the Squarespace code into a code block
- Point the Expo app at your live website

## Notes About Subscriptions

Subscriptions can live in Squarespace.
This pack includes pricing sections in the frontend, but does not enforce plan access in the API yet.
