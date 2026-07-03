import assert from "node:assert/strict";
import "../option_math.js";

const { estimateScenario, estimateCurve } = globalThis.MiraOptionMath;

const common = { spot: 2.29, multiplier: 10000, asOfDate: "2026-07-01" };
const legs = [
  { ...common, symbol: "10011641", optionType: "call", quantity: 15, strike: 2.1, expiryDate: "2026-09-23", volatility: 0.4082 },
  { ...common, symbol: "10011041", optionType: "put", quantity: 20, strike: 1.8, expiryDate: "2026-09-23", volatility: 0.6764 },
  { ...common, symbol: "10011563", optionType: "put", quantity: 20, strike: 1.9, expiryDate: "2026-09-23", volatility: 0.6764 },
  { ...common, symbol: "10011752", optionType: "put", quantity: 11, strike: 2.1, expiryDate: "2026-07-22", volatility: 0.6764 },
  { ...common, symbol: "10011035", optionType: "put", quantity: 71, strike: 1.5, expiryDate: "2026-09-23", volatility: 0.6764 },
];

const result = estimateScenario(legs, { priceMove: -0.05, ivShift: 0 }, { rate: 0.015, dividendYield: 0 });
const putPnl = result.legs.filter(leg => leg.optionType === "put").reduce((sum, leg) => sum + leg.pnl, 0);
const callPnl = result.legs.filter(leg => leg.optionType === "call").reduce((sum, leg) => sum + leg.pnl, 0);

assert.equal(result.used, 5);
assert.ok(result.pnl > 9500 && result.pnl < 9700, `unexpected portfolio pnl: ${result.pnl}`);
assert.ok(putPnl > 20000, `unexpected put pnl: ${putPnl}`);
assert.ok(callPnl < -11000, `unexpected call pnl: ${callPnl}`);

const curve = estimateCurve(legs, { minMove: -0.3, maxMove: 0.3, steps: 24 }, { rate: 0.015, dividendYield: 0 });
assert.equal(curve.points.length, 25);
assert.equal(curve.points[0].priceMove, -0.3);
assert.equal(curve.points[12].priceMove, 0);
assert.equal(curve.points.at(-1).priceMove, 0.3);
assert.equal(curve.points[12].used, 5);
assert.ok(Math.abs(curve.points[12].pnl) < 1e-8, `zero shock should have zero pnl: ${curve.points[12].pnl}`);
assert.ok(curve.points.every(point => point.used === 5));
console.log("option scenario repricing tests passed");
