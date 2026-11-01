// Pour Price Calculator.
// The owner thinks in multipliers ("4x", "4.5x"), so price = cost per oz × pour oz × multiplier,
// rounded UP to the chosen step, with an optional floor on the 1 oz price.
// Every pour is priced from cost (not from the rounded 1 oz price), and we report the
// effective markup after rounding so a human can see and tweak it before anything goes to Toast.

const ML_PER_OZ = 29.5735;
const POURS = [
  { key: '1oz', label: '1 oz', oz: 1 },
  { key: 'highball', label: 'Highball 1.5 oz', oz: 1.5 },
  { key: '2oz', label: '2 oz', oz: 2 },
];

// Defaults match what CG Bible's Back Bar does today (server/routes/backbar.js calculatePricing):
// 4x, $6 minimum 1 oz, rounded up to the whole dollar.
const DEFAULT_SETTINGS = { multiplier: 4, rounding: 1, min_1oz: 6 };

const r2 = (n) => Math.round(n * 100) / 100;

function roundUp(value, step) {
  if (!step || step <= 0) return r2(value);
  // subtract a hair so 6.0000001 doesn't become 7
  return r2(Math.ceil(value / step - 1e-6) * step);
}

function cleanSettings(s = {}) {
  const out = { ...DEFAULT_SETTINGS };
  const m = Number(s.multiplier);
  if (Number.isFinite(m) && m > 0 && m <= 50) out.multiplier = r2(m);
  const rd = Number(s.rounding);
  if ([0, 0.05, 0.1, 0.25, 0.5, 1].includes(rd)) out.rounding = rd;
  const mn = Number(s.min_1oz);
  if (Number.isFinite(mn) && mn >= 0 && mn <= 500) out.min_1oz = r2(mn);
  return out;
}

/**
 * @param {{bottle_cost:number, volume_ml:number}} bottle
 * @param {object} settings  multiplier, rounding, min_1oz
 * @returns {{cost_bottle, volume_ml, oz_per_bottle, cost_per_oz, multiplier, pours:[{key,label,oz,cost,raw,price,markup}]}|null}
 */
function pricePours(bottle, settings) {
  const s = cleanSettings(settings);
  const cost = Number(bottle.bottle_cost);
  const ml = Number(bottle.volume_ml);
  if (!(cost > 0) || !(ml > 0)) return null;
  const ozPerBottle = ml / ML_PER_OZ;
  const costPerOz = cost / ozPerBottle;
  const pours = POURS.map((p) => {
    const pourCost = costPerOz * p.oz;
    let raw = pourCost * s.multiplier;
    if (s.min_1oz) raw = Math.max(raw, s.min_1oz * p.oz);
    const price = roundUp(raw, s.rounding);
    return { ...p, cost: r2(pourCost), raw: r2(raw), price, markup: r2(price / pourCost) };
  });
  return { cost_bottle: r2(cost), volume_ml: ml, oz_per_bottle: r2(ozPerBottle), cost_per_oz: r2(costPerOz), multiplier: s.multiplier, pours };
}

/** Markup a human-edited price works out to, for the review screen. */
function markupFor(price, costPerOz, oz) {
  const c = costPerOz * oz;
  return c > 0 ? r2(price / c) : null;
}

module.exports = { pricePours, markupFor, cleanSettings, roundUp, DEFAULT_SETTINGS, POURS, ML_PER_OZ };
