(function exposeOptionMath(root) {
  "use strict";

  function erf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
    return sign * y;
  }

  function normalCdf(value) {
    return 0.5 * (1 + erf(value / Math.sqrt(2)));
  }

  function blackScholesPrice({ optionType, spot, strike, years, rate = 0.015, dividendYield = 0, volatility }) {
    if (![spot, strike, years, rate, dividendYield, volatility].every(Number.isFinite)) return null;
    if (spot <= 0 || strike <= 0 || volatility <= 0) return null;
    const type = String(optionType || "").toLowerCase();
    if (!new Set(["call", "put"]).has(type)) return null;
    if (years <= 0) return Math.max(type === "call" ? spot - strike : strike - spot, 0);
    const rootTime = Math.sqrt(years);
    const d1 = (Math.log(spot / strike) + (rate - dividendYield + 0.5 * volatility * volatility) * years) / (volatility * rootTime);
    const d2 = d1 - volatility * rootTime;
    const discountedSpot = spot * Math.exp(-dividendYield * years);
    const discountedStrike = strike * Math.exp(-rate * years);
    if (type === "call") return discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2);
    return discountedStrike * normalCdf(-d2) - discountedSpot * normalCdf(-d1);
  }

  function yearsToExpiry(asOfDate, expiryDate) {
    const start = Date.parse(`${asOfDate}T00:00:00Z`);
    const end = Date.parse(`${expiryDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return Math.max((end - start) / (365 * 24 * 60 * 60 * 1000), 0);
  }

  function estimateScenario(legs, scenario, assumptions = {}) {
    const rate = Number.isFinite(assumptions.rate) ? assumptions.rate : 0.015;
    const dividendYield = Number.isFinite(assumptions.dividendYield) ? assumptions.dividendYield : 0;
    const priceMove = Number(scenario?.priceMove || 0);
    const ivShift = Number(scenario?.ivShift || 0);
    const results = [];

    for (const leg of legs || []) {
      const spot = Number(leg.spot);
      const strike = Number(leg.strike);
      const volatility = Number(leg.volatility);
      const quantity = Number(leg.quantity);
      const multiplier = Number(leg.multiplier);
      const years = yearsToExpiry(leg.asOfDate, leg.expiryDate);
      if (![spot, strike, volatility, quantity, multiplier, years].every(Number.isFinite)) continue;
      const shockedSpot = spot * (1 + priceMove);
      const shockedVolatility = Math.max(volatility + ivShift, 0.0001);
      const currentModelPrice = blackScholesPrice({
        optionType: leg.optionType,
        spot,
        strike,
        years,
        rate,
        dividendYield,
        volatility,
      });
      const scenarioModelPrice = blackScholesPrice({
        optionType: leg.optionType,
        spot: shockedSpot,
        strike,
        years,
        rate,
        dividendYield,
        volatility: shockedVolatility,
      });
      if (currentModelPrice == null || scenarioModelPrice == null) continue;
      const pnl = (scenarioModelPrice - currentModelPrice) * quantity * multiplier;
      results.push({
        symbol: leg.symbol || "",
        optionType: String(leg.optionType || "").toLowerCase(),
        pnl,
        currentModelPrice,
        scenarioModelPrice,
      });
    }

    return {
      pnl: results.reduce((sum, leg) => sum + leg.pnl, 0),
      used: results.length,
      legs: results,
      assumptions: { rate, dividendYield },
    };
  }

  function estimateCurve(legs, range = {}, assumptions = {}) {
    const minMove = Number.isFinite(range.minMove) ? range.minMove : -0.3;
    const maxMove = Number.isFinite(range.maxMove) ? range.maxMove : 0.3;
    const steps = Math.max(2, Math.min(120, Math.round(Number(range.steps) || 24)));
    const ivShift = Number.isFinite(range.ivShift) ? range.ivShift : 0;
    const points = Array.from({ length: steps + 1 }, (_, index) => {
      const rawMove = minMove + (maxMove - minMove) * index / steps;
      const priceMove = Math.abs(rawMove) < 1e-12 ? 0 : rawMove;
      const result = estimateScenario(legs, { priceMove, ivShift }, assumptions);
      return { priceMove, pnl: result.pnl, used: result.used, legs: result.legs };
    });
    return { minMove, maxMove, ivShift, points };
  }

  const api = { blackScholesPrice, estimateScenario, estimateCurve, yearsToExpiry };
  root.MiraOptionMath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
