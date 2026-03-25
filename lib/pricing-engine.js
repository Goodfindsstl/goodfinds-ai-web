export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function demandSignalFromCount(count) {
  if (count >= 16) return "High Demand";
  if (count >= 8) return "Moderate Demand";
  return "Low Demand";
}

export function decisionFromMetrics({ estimatedProfit, roi, demandSignal }) {
  if (estimatedProfit >= 12 && roi >= 80 && demandSignal === "High Demand") return "BUY";
  if (estimatedProfit >= 5 && roi >= 30) return "HOLD";
  return "PASS";
}

export function buildRecommendation({ decision, bestPlatform, cleanedTitle }) {
  if (decision === "BUY") {
    return `${cleanedTitle} looks strong right now. List on ${bestPlatform} first and stay near the market median.`;
  }
  if (decision === "HOLD") {
    return `${cleanedTitle} can work, but only at the right buy cost. Keep your price competitive and do not overpay.`;
  }
  return `${cleanedTitle} is too weak at current pricing. Pass unless your cost is extremely low.`;
}
