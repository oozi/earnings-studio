// ---------------------------------------------------------------------------
// Dimensional model for the BXCI earnings cube.
//
// The cube is a classic OLAP star schema:
//   fact value  =  f(scenario layer, metric leaf, business-line leaf, quarter)
// where "scenario layer" is either Actuals or one forecast vintage, and both
// the metric (P&L account) and business-line dimensions are trees. Facts are
// stored only at leaf x leaf granularity; every roll-up is a sum over
// descendant leaves. Expense lines are stored SIGNED (negative) so that any
// subtree total is exact by simple summation.
// ---------------------------------------------------------------------------

// ----------------------------- Time dimension -----------------------------

export interface Quarter {
  idx: number;
  year: number;
  q: number; // 1..4
}

export const QUARTERS: Quarter[] = [];
for (let y = 2023; y <= 2027; y++)
  for (let q = 1; q <= 4; q++) QUARTERS.push({ idx: QUARTERS.length, year: y, q });

export const NQ = QUARTERS.length; // 20 quarters: 2023Q1 .. 2027Q4

/** Last quarter with closed actuals: 1Q26 (today is early July 2026; 2Q26 not yet closed). */
export const LAST_ACTUAL = QUARTERS.findIndex((x) => x.year === 2026 && x.q === 1);

export const qLabel = (i: number) => `${QUARTERS[i].q}Q${String(QUARTERS[i].year).slice(2)}`;
export const qLong = (i: number) => `Q${QUARTERS[i].q} ${QUARTERS[i].year}`;
export const qIdx = (year: number, q: number) => (year - 2023) * 4 + (q - 1);

// -------------------------- Forecast vintage dimension --------------------

export interface Vintage {
  idx: number; // 0-based; cube layer = idx + 1 (layer 0 is Actuals)
  short: string; // "Nov-23"
  label: string; // "Nov-23 (FY24 Budget)"
  madeIn: number; // quarter idx in which this forecast was produced (mid-quarter)
}

/**
 * Re-forecast cycles run mid-quarter (Feb / May / Aug / Nov). The November
 * cycle doubles as the following fiscal year's Budget. Each vintage covers
 * the quarter it is made in (an in-quarter estimate) plus 9 more quarters.
 */
export const VINTAGES: Vintage[] = (() => {
  const cycles = [
    'Nov-23', 'Feb-24', 'May-24', 'Aug-24', 'Nov-24', 'Feb-25', 'May-25',
    'Aug-25', 'Nov-25', 'Feb-26', 'May-26',
  ];
  return cycles.map((short, i) => {
    const madeIn = 3 + i; // Nov-23 is made in 4Q23 (idx 3)
    const isBudget = short.startsWith('Nov');
    const fy = Number(short.slice(-2)) + 1;
    return {
      idx: i,
      short,
      label: isBudget ? `${short} (FY${fy} Budget)` : `${short} reforecast`,
      madeIn,
    };
  });
})();

export const HORIZON = 9; // quarters ahead covered beyond the made-in quarter
export const vFirstTarget = (v: Vintage) => v.madeIn;
export const vLastTarget = (v: Vintage) => Math.min(v.madeIn + HORIZON, NQ - 1);
export const LATEST_VINTAGE = VINTAGES.length - 1; // May-26, covers 2Q26..4Q27

// ------------------------------- Hierarchies -------------------------------

export interface NodeSpec {
  id: string;
  name: string;
  short?: string;
  contra?: boolean; // expense / deduction line (values are <= 0)
  children?: NodeSpec[];
}

export interface HNode {
  id: string;
  name: string;
  short: string;
  contra: boolean;
  children: HNode[];
  parent: HNode | null;
  depth: number;
  isLeaf: boolean;
  leafIdx: number; // index into hierarchy.leaves if leaf, else -1
  leafIdxs: number[]; // leaf indices of all descendant-or-self leaves
  path: string; // "BXCI › Private Credit › Direct Lending"
}

export interface Hierarchy {
  root: HNode;
  byId: Map<string, HNode>;
  leaves: HNode[];
  all: HNode[];
}

export function buildHierarchy(spec: NodeSpec): Hierarchy {
  const byId = new Map<string, HNode>();
  const leaves: HNode[] = [];
  const all: HNode[] = [];

  const build = (s: NodeSpec, parent: HNode | null, depth: number): HNode => {
    const node: HNode = {
      id: s.id,
      name: s.name,
      short: s.short ?? s.name,
      contra: s.contra ?? false,
      children: [],
      parent,
      depth,
      isLeaf: !s.children || s.children.length === 0,
      leafIdx: -1,
      leafIdxs: [],
      path: parent ? `${parent.path} › ${s.short ?? s.name}` : (s.short ?? s.name),
    };
    byId.set(node.id, node);
    all.push(node);
    if (node.isLeaf) {
      node.leafIdx = leaves.length;
      leaves.push(node);
      node.leafIdxs = [node.leafIdx];
    } else {
      for (const c of s.children!) {
        const child = build(c, node, depth + 1);
        node.children.push(child);
        node.leafIdxs.push(...child.leafIdxs);
      }
    }
    return node;
  };

  const root = build(spec, null, 0);
  return { root, byId, leaves, all };
}

/** Walk up to the depth-1 ancestor (segment for business lines, FRE/NR for metrics). */
export function topAncestor(n: HNode): HNode {
  let cur = n;
  while (cur.depth > 1 && cur.parent) cur = cur.parent;
  return cur;
}

// ------------------------- Metric (P&L account) tree -----------------------
// Blackstone-style Distributable Earnings presentation. Leaf order (DFS) is
// the storage order of the metric axis: base, txn, frpr, comp, opex, rpr,
// rpc, pii.

export const METRIC_SPEC: NodeSpec = {
  id: 'de', name: 'Distributable Earnings', short: 'DE',
  children: [
    {
      id: 'fre', name: 'Fee Related Earnings', short: 'FRE',
      children: [
        {
          id: 'frr', name: 'Fee Related Revenues', short: 'Fee Revenues',
          children: [
            {
              id: 'mgmt', name: 'Management Fees, net', short: 'Mgmt Fees',
              children: [
                { id: 'base', name: 'Base Management Fees', short: 'Base Mgmt Fees' },
                { id: 'txn', name: 'Transaction & Advisory Fees, net', short: 'Txn & Advisory' },
              ],
            },
            { id: 'frpr', name: 'Fee Related Performance Revenues', short: 'Fee Perf Revenues' },
          ],
        },
        {
          id: 'frx', name: 'Fee Related Expenses', short: 'Fee Expenses', contra: true,
          children: [
            { id: 'comp', name: 'Fee Related Compensation', short: 'Fee Comp', contra: true },
            { id: 'opex', name: 'Operating Expenses', short: 'OpEx', contra: true },
          ],
        },
      ],
    },
    {
      id: 'nr', name: 'Net Realizations', short: 'Net Realizations',
      children: [
        { id: 'rpr', name: 'Realized Performance Revenues', short: 'Realized Perf Revenues' },
        { id: 'rpc', name: 'Realized Performance Compensation', short: 'Realized Perf Comp', contra: true },
        { id: 'pii', name: 'Realized Principal Investment Income', short: 'Principal Inv Income' },
      ],
    },
  ],
};

// --------------------------- Business-line tree ----------------------------
// BXCI (Blackstone Credit & Insurance) style: segments › strategies › funds.
// 29 fund-level leaves. All figures generated for these are synthetic.

export const BUSINESS_SPEC: NodeSpec = {
  id: 'bxci', name: 'BXCI (Total)', short: 'BXCI',
  children: [
    {
      id: 'liq', name: 'Liquid Credit Strategies', short: 'Liquid Credit',
      children: [
        {
          id: 'clo', name: 'CLO Platform', short: 'CLOs',
          children: [
            { id: 'clo19', name: 'BXC CLO 2019-1 (runoff)', short: 'CLO 2019-1' },
            { id: 'clo21', name: 'BXC CLO 2021-1', short: 'CLO 2021-1' },
            { id: 'clo22', name: 'BXC CLO 2022-2', short: 'CLO 2022-2' },
            { id: 'clo23', name: 'BXC CLO 2023-1', short: 'CLO 2023-1' },
            { id: 'clo24', name: 'BXC CLO 2024-1', short: 'CLO 2024-1' },
          ],
        },
        {
          id: 'lhy', name: 'Loan & High Yield Funds', short: 'Loans & HY',
          children: [
            { id: 'sfr', name: 'Senior Floating Rate Fund', short: 'Sr Floating Rate' },
            { id: 'ghy', name: 'Global High Yield Fund', short: 'Global HY' },
            { id: 'mac', name: 'Multi-Asset Credit Fund', short: 'Multi-Asset Credit' },
          ],
        },
        {
          id: 'cef', name: 'Listed Closed-End Funds', short: 'Listed CEFs',
          children: [
            { id: 'cef1', name: 'Floating Rate Income Fund (listed)', short: 'Floating Rate CEF' },
            { id: 'cef2', name: 'Strategic Credit Fund (listed)', short: 'Strategic Credit CEF' },
          ],
        },
      ],
    },
    {
      id: 'pc', name: 'Private Credit Strategies', short: 'Private Credit',
      children: [
        {
          id: 'dl', name: 'Direct Lending', short: 'Direct Lending',
          children: [
            { id: 'bcred', name: 'BCRED', short: 'BCRED' },
            { id: 'bxsl', name: 'BXSL', short: 'BXSL' },
            { id: 'dl3', name: 'Direct Lending Fund III', short: 'DL Fund III' },
            { id: 'dl4', name: 'Direct Lending Fund IV', short: 'DL Fund IV' },
            { id: 'edl2', name: 'European Direct Lending Fund II', short: 'Euro DL II' },
          ],
        },
        {
          id: 'opp', name: 'Opportunistic & Mezzanine', short: 'Opportunistic',
          children: [
            { id: 'cop4', name: 'Capital Opportunities Fund IV', short: 'Cap Opps IV' },
            { id: 'cop5', name: 'Capital Opportunities Fund V', short: 'Cap Opps V' },
            { id: 'mez3', name: 'Mezzanine Partners III (runoff)', short: 'Mezz III' },
          ],
        },
      ],
    },
    {
      id: 'iabc', name: 'Infrastructure & Asset Based Credit', short: 'Infra & ABC',
      children: [
        {
          id: 'infra', name: 'Infrastructure Credit', short: 'Infra Credit',
          children: [
            { id: 'inf1', name: 'Infrastructure Credit Fund I', short: 'Infra Credit I' },
            { id: 'inf2', name: 'Infrastructure Credit Fund II', short: 'Infra Credit II' },
            { id: 'etc', name: 'Energy Transition Credit Fund', short: 'Energy Transition' },
          ],
        },
        {
          id: 'abf', name: 'Asset Based Finance', short: 'Asset Based Fin',
          children: [
            { id: 'abif', name: 'Asset Based Income Fund', short: 'ABF Income' },
            { id: 'sfp', name: 'Specialty Finance Partners', short: 'Specialty Fin' },
            { id: 'rcf', name: 'Receivables & Consumer Finance Fund', short: 'Receivables & Consumer' },
          ],
        },
      ],
    },
    {
      id: 'ins', name: 'Insurance Solutions', short: 'Insurance',
      children: [
        { id: 'cbre', name: 'Corebridge SMA', short: 'Corebridge' },
        { id: 'evl', name: 'Everlake SMA', short: 'Everlake' },
        { id: 'fg', name: 'F&G SMA', short: 'F&G' },
        { id: 'rsl', name: 'Resolution Life SMA', short: 'Resolution Life' },
        { id: 'oins', name: 'Other Insurance SMAs', short: 'Other SMAs' },
      ],
    },
  ],
};

// Leaf-metric ids in DFS order — must match METRIC_SPEC leaf traversal.
export const METRIC_LEAF_IDS = ['base', 'txn', 'frpr', 'comp', 'opex', 'rpr', 'rpc', 'pii'] as const;
export type MetricLeafId = (typeof METRIC_LEAF_IDS)[number];
