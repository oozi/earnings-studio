// Sanity checks for the generated cube. Run with: npm run sanity
import { generateDataset } from './generate';
import { Cube, LayerSel } from './engine';
import {
  LAST_ACTUAL, LATEST_VINTAGE, METRIC_LEAF_IDS, NQ, QUARTERS, VINTAGES,
  qLabel, vFirstTarget, vLastTarget,
} from './model';

const ds = generateDataset();
const cube = new Cube(ds);
const { metricH, businessH } = ds;

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) { failures++; console.error(`FAIL: ${msg}`); }
};

// 0. Metric leaf order matches the storage convention.
METRIC_LEAF_IDS.forEach((id, i) => {
  const n = metricH.byId.get(id)!;
  check(n.leafIdx === i, `metric leaf order: ${id} expected ${i} got ${n.leafIdx}`);
});

// 1. Parent = sum of children across both hierarchies, all layer kinds.
const sels: LayerSel[] = [
  { kind: 'actual' }, { kind: 'blend' },
  { kind: 'vintage', v: 0 }, { kind: 'vintage', v: 5 }, { kind: 'vintage', v: LATEST_VINTAGE },
];
for (const sel of sels) {
  for (const q of [0, 4, 8, 11, 12, 13, 16, 19]) {
    for (const mn of metricH.all.filter((n) => !n.isLeaf)) {
      for (const bn of [businessH.root, businessH.byId.get('pc')!, businessH.byId.get('dl')!]) {
        const parent = cube.value(sel, mn, bn, q);
        const kids = mn.children.map((c) => cube.value(sel, c, bn, q));
        if (parent === null) { check(kids.every((k) => k === null), `null parent w/ non-null kids ${mn.id} ${qLabel(q)}`); continue; }
        const sum = kids.reduce<number>((s, k) => s + (k ?? 0), 0);
        check(Math.abs(parent - sum) < 1e-6, `metric rollup ${mn.id}/${bn.id} ${qLabel(q)} ${JSON.stringify(sel)}: ${parent} vs ${sum}`);
      }
    }
    for (const bn of businessH.all.filter((n) => !n.isLeaf)) {
      const parent = cube.value(sel, metricH.root, bn, q);
      if (parent === null) continue;
      const sum = bn.children.reduce<number>((s, c) => s + (cube.value(sel, metricH.root, c, q) ?? 0), 0);
      check(Math.abs(parent - sum) < 1e-6, `business rollup ${bn.id} ${qLabel(q)}: ${parent} vs ${sum}`);
    }
  }
}

// 2. Blend semantics: actual through LAST_ACTUAL, latest vintage after.
for (let q = 0; q < NQ; q++) {
  const blend = cube.value({ kind: 'blend' }, metricH.root, businessH.root, q);
  const expect =
    q <= LAST_ACTUAL
      ? cube.value({ kind: 'actual' }, metricH.root, businessH.root, q)
      : cube.value({ kind: 'vintage', v: LATEST_VINTAGE }, metricH.root, businessH.root, q);
  check(blend === expect, `blend mismatch at ${qLabel(q)}`);
  check(blend !== null, `blend null at ${qLabel(q)}`);
}
check(cube.value({ kind: 'actual' }, metricH.root, businessH.root, LAST_ACTUAL + 1) === null, 'actuals should end at LAST_ACTUAL');

// 3. Vintage coverage windows.
for (const v of VINTAGES) {
  const sel: LayerSel = { kind: 'vintage', v: v.idx };
  if (vFirstTarget(v) > 0)
    check(cube.value(sel, metricH.root, businessH.root, vFirstTarget(v) - 1) === null, `${v.short} covers before window`);
  check(cube.value(sel, metricH.root, businessH.root, vFirstTarget(v)) !== null, `${v.short} missing first target`);
  check(cube.value(sel, metricH.root, businessH.root, vLastTarget(v)) !== null, `${v.short} missing last target`);
  if (vLastTarget(v) < NQ - 1)
    check(cube.value(sel, metricH.root, businessH.root, vLastTarget(v) + 1) === null, `${v.short} covers past window`);
}

// 4. Forecast convergence: |error| for DE should shrink as horizon shrinks.
const de = metricH.root, bx = businessH.root;
console.log('\nForecast convergence for DE (target 4Q25):');
const actual4q25 = cube.value({ kind: 'actual' }, de, bx, 11)!;
const evo = cube.evolution(de, bx, 11);
for (const e of evo) {
  const err = ((e.value! - actual4q25) / actual4q25) * 100;
  console.log(`  ${e.vintage.short.padEnd(7)} h=${String(e.horizon).padStart(2)}  ${e.value!.toFixed(1).padStart(8)}  err ${err.toFixed(1)}%`);
}
console.log(`  Actual          ${actual4q25.toFixed(1).padStart(8)}`);
const firstErr = Math.abs(evo[0].value! - actual4q25);
const lastErr = Math.abs(evo[evo.length - 1].value! - actual4q25);
check(lastErr < firstErr, `convergence: in-quarter error (${lastErr.toFixed(1)}) should beat ${evo[0].vintage.short} error (${firstErr.toFixed(1)})`);

// 5. Headline scale (eyeball check).
const line = (id: string) => {
  const n = metricH.byId.get(id)!;
  const fy = (y: number, sel: LayerSel) => {
    let s = 0;
    for (let q = 0; q < NQ; q++)
      if (QUARTERS[q].year === y) s += cube.value(sel, n, bx, q) ?? 0;
    return s;
  };
  console.log(
    `  ${n.short.padEnd(18)} FY24A ${fy(2024, { kind: 'actual' }).toFixed(0).padStart(6)}   FY25A ${fy(2025, { kind: 'actual' }).toFixed(0).padStart(6)}   FY26E ${fy(2026, { kind: 'blend' }).toFixed(0).padStart(6)}   FY27E ${fy(2027, { kind: 'blend' }).toFixed(0).padStart(6)}`,
  );
};
console.log('\nHeadline P&L ($M):');
['de', 'fre', 'frr', 'frx', 'nr', 'base', 'frpr', 'rpr'].forEach(line);

console.log('\n1Q26A DE by segment ($M):');
for (const seg of businessH.root.children)
  console.log(`  ${seg.short.padEnd(16)} ${cube.value({ kind: 'actual' }, de, seg, LAST_ACTUAL)!.toFixed(1).padStart(8)}`);

console.log('\nTop movers DE 3Q25 -> 4Q25 (business leaves, $M):');
for (const mv of cube.leafMovers('business', de, bx, { sel: { kind: 'actual' }, q: 10 }, { sel: { kind: 'actual' }, q: 11 }, 6))
  console.log(`  ${mv.node.short.padEnd(24)} ${(mv.delta >= 0 ? '+' : '') + mv.delta.toFixed(1)}`);

console.log(failures === 0 ? '\nAll sanity checks passed.' : `\n${failures} CHECKS FAILED`);
if (failures > 0) throw new Error(`${failures} sanity checks failed`);
