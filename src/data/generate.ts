// ---------------------------------------------------------------------------
// Synthetic data generator. Deterministic (seeded PRNG) so every session sees
// the same numbers. All values are USD millions, quarterly.
//
// Design:
//  * Every fund x leaf-metric has a smooth deterministic BASE path
//    (growth, launches, ramps, seasonality) plus noise -> TRUTH.
//  * Actuals layer  = truth for quarters <= LAST_ACTUAL.
//  * Each forecast vintage layer = base path re-composed using only the
//    information KNOWN at that vintage (events have "known from" schedules),
//    distorted by a per-(vintage,fund,metric) level + slope error that decays
//    as the horizon shrinks. In-quarter estimates blend toward truth.
//  * Discrete events (crystallizations, mandate step-ups, fund launches)
//    create the interesting variance / forecast-evolution stories.
// ---------------------------------------------------------------------------

import {
  BUSINESS_SPEC, METRIC_SPEC, METRIC_LEAF_IDS, MetricLeafId, buildHierarchy,
  Hierarchy, LAST_ACTUAL, NQ, VINTAGES, vFirstTarget, vLastTarget,
} from './model';

// ------------------------------ PRNG helpers ------------------------------

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------ Fund universe ------------------------------

type FundType = 'perpetual' | 'insurance' | 'drawdown' | 'runoff' | 'clo' | 'openend';

interface FundParams {
  id: string;
  type: FundType;
  scale: number; // base management fees $M/quarter at 2023Q1 (or at launch)
  growth: number; // per-quarter fee growth
  launchQ?: number; // first quarter with fees
  txnMult: number; // transaction/advisory fee intensity vs base fees
  frprBase: number; // fee-related performance revenues $M/qtr baseline (0 = none)
  compRatio: number; // fee-related comp as share of fee revenues
  opexFixed: number; // fixed opex $M/qtr
  realizer?: { p: number; lo: number; hi: number }; // stochastic realized perf rev
  piiBase: number; // principal investment income scale $M/qtr
}

const F = (p: FundParams) => p;

const FUNDS: FundParams[] = [
  // --- Liquid Credit: CLO platform ---
  F({ id: 'clo19', type: 'runoff', scale: 5.5, growth: -0.05, txnMult: 0.01, frprBase: 0, compRatio: 0.4, opexFixed: 0.7, realizer: { p: 0.1, lo: 1.5, hi: 5 }, piiBase: 0.3 }),
  F({ id: 'clo21', type: 'clo', scale: 6.5, growth: 0.0, txnMult: 0.01, frprBase: 0, compRatio: 0.4, opexFixed: 0.8, realizer: { p: 0.1, lo: 2, hi: 6 }, piiBase: 0.4 }),
  F({ id: 'clo22', type: 'clo', scale: 6.0, growth: 0.002, txnMult: 0.01, frprBase: 0, compRatio: 0.4, opexFixed: 0.8, realizer: { p: 0.1, lo: 2, hi: 6 }, piiBase: 0.4 }),
  F({ id: 'clo23', type: 'clo', scale: 5.0, growth: 0.005, txnMult: 0.015, frprBase: 0, compRatio: 0.4, opexFixed: 0.7, realizer: { p: 0.1, lo: 2, hi: 5 }, piiBase: 0.3 }),
  F({ id: 'clo24', type: 'clo', scale: 5.5, growth: 0.004, launchQ: 5, txnMult: 0.02, frprBase: 0, compRatio: 0.4, opexFixed: 0.7, realizer: { p: 0.08, lo: 2, hi: 5 }, piiBase: 0.3 }),
  // --- Liquid Credit: loan & HY funds ---
  F({ id: 'sfr', type: 'openend', scale: 7.5, growth: 0.012, txnMult: 0.02, frprBase: 0, compRatio: 0.41, opexFixed: 1.0, piiBase: 0.5 }),
  F({ id: 'ghy', type: 'openend', scale: 5.5, growth: 0.01, txnMult: 0.02, frprBase: 0, compRatio: 0.41, opexFixed: 0.8, piiBase: 0.4 }),
  F({ id: 'mac', type: 'openend', scale: 6.5, growth: 0.015, txnMult: 0.025, frprBase: 0.6, compRatio: 0.4, opexFixed: 0.9, piiBase: 0.4 }),
  // --- Liquid Credit: listed CEFs ---
  F({ id: 'cef1', type: 'openend', scale: 4.5, growth: 0.003, txnMult: 0.01, frprBase: 1.2, compRatio: 0.38, opexFixed: 0.6, piiBase: 0.3 }),
  F({ id: 'cef2', type: 'openend', scale: 3.8, growth: 0.003, txnMult: 0.01, frprBase: 1.0, compRatio: 0.38, opexFixed: 0.5, piiBase: 0.3 }),
  // --- Private Credit: direct lending ---
  F({ id: 'bcred', type: 'perpetual', scale: 70, growth: 0.028, txnMult: 0.07, frprBase: 26, compRatio: 0.35, opexFixed: 8.5, piiBase: 3.0 }),
  F({ id: 'bxsl', type: 'perpetual', scale: 24, growth: 0.018, txnMult: 0.05, frprBase: 8, compRatio: 0.35, opexFixed: 3.0, piiBase: 1.2 }),
  F({ id: 'dl3', type: 'drawdown', scale: 17, growth: -0.004, txnMult: 0.06, frprBase: 0, compRatio: 0.37, opexFixed: 2.2, realizer: { p: 0.18, lo: 5, hi: 18 }, piiBase: 1.0 }),
  F({ id: 'dl4', type: 'drawdown', scale: 15, growth: 0.05, launchQ: 6, txnMult: 0.09, frprBase: 0, compRatio: 0.37, opexFixed: 2.0, realizer: { p: 0.08, lo: 4, hi: 12 }, piiBase: 0.8 }),
  F({ id: 'edl2', type: 'drawdown', scale: 11, growth: 0.02, txnMult: 0.07, frprBase: 0, compRatio: 0.38, opexFixed: 1.6, realizer: { p: 0.15, lo: 4, hi: 14 }, piiBase: 0.7 }),
  // --- Private Credit: opportunistic & mezzanine ---
  F({ id: 'cop4', type: 'drawdown', scale: 14, growth: 0.002, txnMult: 0.05, frprBase: 0, compRatio: 0.38, opexFixed: 1.8, realizer: { p: 0.22, lo: 8, hi: 30 }, piiBase: 1.0 }),
  F({ id: 'cop5', type: 'drawdown', scale: 9, growth: 0.06, launchQ: 9, txnMult: 0.08, frprBase: 0, compRatio: 0.38, opexFixed: 1.4, realizer: { p: 0.1, lo: 5, hi: 15 }, piiBase: 0.6 }),
  F({ id: 'mez3', type: 'runoff', scale: 5, growth: -0.06, txnMult: 0.02, frprBase: 0, compRatio: 0.39, opexFixed: 0.7, realizer: { p: 0.25, lo: 4, hi: 14 }, piiBase: 0.4 }),
  // --- IABC: infrastructure credit ---
  F({ id: 'inf1', type: 'drawdown', scale: 9, growth: 0.008, txnMult: 0.05, frprBase: 0, compRatio: 0.37, opexFixed: 1.2, realizer: { p: 0.12, lo: 4, hi: 12 }, piiBase: 0.6 }),
  F({ id: 'inf2', type: 'drawdown', scale: 7, growth: 0.045, launchQ: 7, txnMult: 0.07, frprBase: 0, compRatio: 0.37, opexFixed: 1.0, realizer: { p: 0.06, lo: 3, hi: 8 }, piiBase: 0.5 }),
  F({ id: 'etc', type: 'drawdown', scale: 7, growth: 0.025, txnMult: 0.06, frprBase: 0, compRatio: 0.37, opexFixed: 1.0, realizer: { p: 0.1, lo: 5, hi: 15 }, piiBase: 0.5 }),
  // --- IABC: asset based finance ---
  F({ id: 'abif', type: 'perpetual', scale: 9.5, growth: 0.022, txnMult: 0.05, frprBase: 3, compRatio: 0.36, opexFixed: 1.3, realizer: { p: 0.1, lo: 3, hi: 9 }, piiBase: 0.7 }),
  F({ id: 'sfp', type: 'drawdown', scale: 7.5, growth: 0.015, txnMult: 0.06, frprBase: 0, compRatio: 0.37, opexFixed: 1.1, realizer: { p: 0.12, lo: 3, hi: 10 }, piiBase: 0.5 }),
  F({ id: 'rcf', type: 'perpetual', scale: 5.5, growth: 0.05, launchQ: 10, txnMult: 0.06, frprBase: 2, compRatio: 0.36, opexFixed: 0.9, piiBase: 0.4 }),
  // --- Insurance Solutions (SMAs: no perf fees, leaner comp, steady PII) ---
  F({ id: 'cbre', type: 'insurance', scale: 26, growth: 0.012, txnMult: 0.005, frprBase: 0, compRatio: 0.3, opexFixed: 2.6, piiBase: 2.0 }),
  F({ id: 'evl', type: 'insurance', scale: 15, growth: 0.01, txnMult: 0.005, frprBase: 0, compRatio: 0.3, opexFixed: 1.6, piiBase: 1.3 }),
  F({ id: 'fg', type: 'insurance', scale: 18, growth: 0.014, txnMult: 0.005, frprBase: 0, compRatio: 0.3, opexFixed: 1.9, piiBase: 1.5 }),
  F({ id: 'rsl', type: 'insurance', scale: 14, growth: 0.012, txnMult: 0.005, frprBase: 0, compRatio: 0.3, opexFixed: 1.5, piiBase: 1.2 }),
  F({ id: 'oins', type: 'insurance', scale: 7, growth: 0.02, txnMult: 0.005, frprBase: 0, compRatio: 0.31, opexFixed: 0.9, piiBase: 0.6 }),
];

// ------------------------------ Story events -------------------------------

/** Persistent (or windowed) multiplicative change to a fund's base path. */
interface MultEvent {
  fund: string;
  metric: MetricLeafId;
  fromQ: number;
  toQ?: number; // inclusive; undefined = permanent
  factor: number;
  knownFromV: number; // first vintage idx that reflects it
  note: string;
}

/** One-off additive amount in a single quarter, with a per-vintage knowledge schedule. */
interface AddEvent {
  fund: string;
  metric: MetricLeafId;
  q: number;
  amount: number;
  schedule: { v: number; amount: number }[]; // vintages >= v forecast `amount`
  note: string;
}

const MULT_EVENTS: MultEvent[] = [
  // Resolution Life mandate step-up starting 1Q25; signed / known from Aug-24.
  { fund: 'rsl', metric: 'base', fromQ: 8, factor: 1.55, knownFromV: 3, note: 'Resolution Life mandate expansion' },
  // BCRED fee-related performance revenue dip in 2Q24 (spread compression) — a forecast miss.
  { fund: 'bcred', metric: 'frpr', fromQ: 5, toQ: 5, factor: 0.35, knownFromV: 2, note: 'BCRED 2Q24 FRPR dip' },
];

const ADD_EVENTS: AddEvent[] = [
  // Cap Opps IV crystallization in 4Q25 — the big realization story. Unknown
  // before Aug-25, sized up at Nov-25.
  { fund: 'cop4', metric: 'rpr', q: 11, amount: 95, schedule: [{ v: 7, amount: 55 }, { v: 8, amount: 90 }], note: 'Cap Opps IV crystallization' },
  // Energy Transition realization expected 3Q26 (forecast-only, in the future).
  { fund: 'etc', metric: 'rpr', q: 14, amount: 32, schedule: [{ v: 8, amount: 24 }, { v: 9, amount: 30 }, { v: 10, amount: 32 }], note: 'Energy Transition exit' },
  // Mezz III realization 1Q24, flagged in the FY24 budget.
  { fund: 'mez3', metric: 'rpr', q: 4, amount: 18, schedule: [{ v: 0, amount: 12 }, { v: 1, amount: 18 }], note: 'Mezz III realization' },
  // DL III realization 2Q25.
  { fund: 'dl3', metric: 'rpr', q: 9, amount: 22, schedule: [{ v: 5, amount: 15 }, { v: 6, amount: 22 }], note: 'DL III realization' },
  // DL Fund IV final-close catch-up fees 1Q25, in plan from Nov-24 budget.
  { fund: 'dl4', metric: 'base', q: 8, amount: 9, schedule: [{ v: 4, amount: 8 }], note: 'DL IV final close catch-up' },
  // Cap Opps V catch-up fees 2Q26.
  { fund: 'cop5', metric: 'rpr', q: 13, amount: 0, schedule: [], note: 'placeholder (unused)' },
  { fund: 'cop5', metric: 'base', q: 13, amount: 7, schedule: [{ v: 9, amount: 6 }, { v: 10, amount: 7 }], note: 'Cap Opps V catch-up fees' },
];

// ------------------------------ Dataset shape ------------------------------

export interface Dataset {
  metricH: Hierarchy;
  businessH: Hierarchy;
  /** layers[0] = Actuals; layers[1 + v] = vintage v. NaN = not covered. */
  layers: Float64Array[];
  NM: number; // metric leaves
  NB: number; // business leaves
  seed: number;
}

export const cellIdx = (NB: number, m: number, b: number, q: number) => (m * NB + b) * NQ + q;

// ------------------------------- Generation --------------------------------

export function generateDataset(seed = 20260702): Dataset {
  const metricH = buildHierarchy(METRIC_SPEC);
  const businessH = buildHierarchy(BUSINESS_SPEC);
  const NM = metricH.leaves.length;
  const NB = businessH.leaves.length;

  const rand = mulberry32(seed);
  // Standard normal via Box-Muller.
  const randn = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const fundById = new Map(FUNDS.map((f) => [f.id, f]));
  for (const leaf of businessH.leaves)
    if (!fundById.has(leaf.id)) throw new Error(`No fund params for business leaf ${leaf.id}`);

  const mIdx = new Map<MetricLeafId, number>();
  METRIC_LEAF_IDS.forEach((id) => {
    const node = metricH.byId.get(id);
    if (!node || node.leafIdx < 0) throw new Error(`Metric leaf ${id} missing`);
    mIdx.set(id, node.leafIdx);
  });

  // --- base paths (deterministic), parameterized by event knowledge ---------

  type Know = (knownFromV: number) => boolean;
  const KNOW_ALL: Know = () => true;

  const multFactor = (fund: string, metric: MetricLeafId, q: number, know: Know) => {
    let f = 1;
    for (const e of MULT_EVENTS)
      if (e.fund === fund && e.metric === metric && know(e.knownFromV) && q >= e.fromQ && (e.toQ === undefined || q <= e.toQ))
        f *= e.factor;
    return f;
  };

  const addAmount = (fund: string, metric: MetricLeafId, q: number, vIdx: number | null) => {
    let sum = 0;
    for (const e of ADD_EVENTS) {
      if (e.fund !== fund || e.metric !== metric || e.q !== q) continue;
      if (vIdx === null) sum += e.amount; // truth
      else {
        let amt = 0;
        for (const s of e.schedule) if (vIdx >= s.v) amt = s.amount;
        sum += amt;
      }
    }
    return sum;
  };

  const feeBase = (f: FundParams, q: number, know: Know): number => {
    let v: number;
    if (f.launchQ !== undefined) {
      if (q < f.launchQ) return 0;
      const k = q - f.launchQ;
      v = f.scale * Math.pow(1 + f.growth, k) * (k === 0 ? 0.7 : 1);
    } else {
      v = f.scale * Math.pow(1 + f.growth, q);
    }
    return v * multFactor(f.id, 'base', q, know);
  };

  const frprBasePath = (f: FundParams, q: number, know: Know): number => {
    if (f.frprBase <= 0) return 0;
    let v = f.frprBase * Math.pow(1 + Math.max(f.growth, 0.008), q);
    if (f.launchQ !== undefined && q < f.launchQ + 1) v = 0;
    return v * multFactor(f.id, 'frpr', q, know);
  };

  const isQ4 = (q: number) => q % 4 === 3;
  const compRatioAt = (f: FundParams, q: number) => f.compRatio * (isQ4(q) ? 1.09 : 1);
  const opexAt = (f: FundParams, q: number, feeRevs: number) =>
    -(f.opexFixed * Math.pow(1.007, q) * (f.launchQ !== undefined && q < f.launchQ ? 0.25 : 1) + 0.055 * Math.max(feeRevs, 0));

  // --- truth ----------------------------------------------------------------

  // truth[fundLeafIdx][metricLeafIdx][q]
  const truth: number[][][] = businessH.leaves.map(() =>
    METRIC_LEAF_IDS.map(() => new Array<number>(NQ).fill(0)),
  );

  businessH.leaves.forEach((leaf, b) => {
    const f = fundById.get(leaf.id)!;
    const wavePhase = rand() * Math.PI * 2;
    for (let q = 0; q < NQ; q++) {
      const base = feeBase(f, q, KNOW_ALL) * (1 + 0.012 * randn()) + addAmount(f.id, 'base', q, null);
      const txn = feeBase(f, q, KNOW_ALL) * f.txnMult * Math.exp(0.6 * randn() - 0.18) + addAmount(f.id, 'txn', q, null);
      const frpr =
        frprBasePath(f, q, KNOW_ALL) * (1 + 0.3 * Math.sin(q * 0.9 + wavePhase) + 0.1 * randn()) +
        addAmount(f.id, 'frpr', q, null);
      const feeRevs = base + txn + Math.max(frpr, 0);
      const comp = -compRatioAt(f, q) * feeRevs * (1 + 0.02 * randn());
      const opex = opexAt(f, q, feeRevs) * (1 + 0.03 * randn());
      let rpr = addAmount(f.id, 'rpr', q, null);
      if (f.realizer && rand() < f.realizer.p && (f.launchQ === undefined || q >= f.launchQ + 2))
        rpr += f.realizer.lo + rand() * (f.realizer.hi - f.realizer.lo);
      const rpc = rpr > 0 ? -0.45 * rpr * (1 + 0.05 * randn()) : 0;
      const pii = f.piiBase * (1 + 0.9 * randn()) * (f.launchQ !== undefined && q < f.launchQ ? 0 : 1);

      const row = truth[b];
      row[mIdx.get('base')!][q] = Math.max(base, 0);
      row[mIdx.get('txn')!][q] = Math.max(txn, 0);
      row[mIdx.get('frpr')!][q] = Math.max(frpr, 0);
      row[mIdx.get('comp')!][q] = Math.min(comp, 0);
      row[mIdx.get('opex')!][q] = Math.min(opex, 0);
      row[mIdx.get('rpr')!][q] = Math.max(rpr, 0);
      row[mIdx.get('rpc')!][q] = Math.min(rpc, 0);
      row[mIdx.get('pii')!][q] = pii;
    }
  });

  // --- layers -----------------------------------------------------------------

  const nLayers = 1 + VINTAGES.length;
  const layers: Float64Array[] = [];
  for (let l = 0; l < nLayers; l++) layers.push(new Float64Array(NM * NB * NQ).fill(NaN));

  // Actuals.
  for (let b = 0; b < NB; b++)
    for (let m = 0; m < NM; m++)
      for (let q = 0; q <= LAST_ACTUAL; q++)
        layers[0][cellIdx(NB, m, b, q)] = truth[b][m][q];

  // Forecast error profile per metric class: level sd, slope bias, slope sd, iid sd.
  const ERR: Record<MetricLeafId, { sL: number; bS: number; sS: number; sI: number }> = {
    base: { sL: 0.01, bS: -0.004, sS: 0.004, sI: 0.004 },
    txn:  { sL: 0.06, bS: -0.01, sS: 0.02, sI: 0.05 },
    frpr: { sL: 0.05, bS: -0.008, sS: 0.025, sI: 0.04 },
    comp: { sL: 0.012, bS: -0.004, sS: 0.005, sI: 0.006 },
    opex: { sL: 0.015, bS: -0.006, sS: 0.005, sI: 0.008 },
    rpr:  { sL: 0.1, bS: 0.01, sS: 0.04, sI: 0.1 },
    rpc:  { sL: 0.05, bS: 0, sS: 0.02, sI: 0.05 },
    pii:  { sL: 0.2, bS: 0, sS: 0.05, sI: 0.15 },
  };

  for (const v of VINTAGES) {
    const know: Know = (kv) => v.idx >= kv;
    const first = vFirstTarget(v);
    const last = vLastTarget(v);

    businessH.leaves.forEach((leaf, b) => {
      const f = fundById.get(leaf.id)!;

      // Launch visibility: vintages taken well before a launch only partially
      // reflect the pipeline fund.
      let vis = 1;
      if (f.launchQ !== undefined) {
        if (v.madeIn >= f.launchQ - 1) vis = 1;
        else if (v.madeIn === f.launchQ - 2) vis = 0.85;
        else vis = 0.6;
      }

      // Level/slope error draws per (vintage, fund, metric).
      const draws = METRIC_LEAF_IDS.map((mid) => {
        const e = ERR[mid];
        return { a: e.sL * randn(), b: e.bS + e.sS * randn(), sI: e.sI };
      });

      for (let t = first; t <= last; t++) {
        const h = t - v.madeIn;

        const baseF = (feeBase(f, t, know) + addAmount(f.id, 'base', t, v.idx)) * vis;
        const txnF = feeBase(f, t, know) * f.txnMult * vis + addAmount(f.id, 'txn', t, v.idx);
        const frprF = frprBasePath(f, t, know) * vis + addAmount(f.id, 'frpr', t, v.idx);
        const feeRevsF = baseF + txnF + frprF;
        const compF = -compRatioAt(f, t) * feeRevsF;
        const opexF = opexAt(f, t, feeRevsF) * (f.launchQ !== undefined && v.madeIn < f.launchQ - 1 ? vis : 1);
        // Realized perf revenues: smeared baseline expectation + known events.
        const evRpr = addAmount(f.id, 'rpr', t, v.idx);
        const rprBaselineOk = f.realizer && (f.launchQ === undefined || t >= f.launchQ + 2);
        const rprBaseline = rprBaselineOk ? f.realizer!.p * (f.realizer!.lo + f.realizer!.hi) * 0.5 : 0;
        const rprF = evRpr > 0 ? rprBaseline * 0.25 + evRpr : rprBaseline;
        const rpcF = -0.45 * rprF;
        const piiF = f.piiBase * (f.launchQ !== undefined && t < f.launchQ ? 0 : 1);

        const bases: Record<MetricLeafId, number> = {
          base: baseF, txn: txnF, frpr: frprF, comp: compF, opex: opexF,
          rpr: rprF, rpc: rpcF, pii: piiF,
        };

        METRIC_LEAF_IDS.forEach((mid, mi) => {
          const d = draws[mi];
          let val = bases[mid] * (1 + d.a + d.b * h) + bases[mid] * d.sI * (1 + 0.25 * h) * randn() * 0.5;
          // In-quarter estimate: two months of actuals in hand -> blend to truth.
          if (h === 0) val = 0.65 * truth[b][mi][t] + 0.35 * val;
          // Sign discipline.
          if (mid === 'comp' || mid === 'opex' || mid === 'rpc') val = Math.min(val, 0);
          else if (mid !== 'pii') val = Math.max(val, 0);
          layers[1 + v.idx][cellIdx(NB, mi, b, t)] = val;
        });
      }
    });
  }

  return { metricH, businessH, layers, NM, NB, seed };
}
