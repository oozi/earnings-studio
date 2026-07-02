// ---------------------------------------------------------------------------
// In-memory OLAP engine over the dense fact cube. Every query is a sum over
// the Cartesian product of the metric node's and business node's descendant
// leaves — small enough (8 x 29 leaves max) that everything is instant.
// ---------------------------------------------------------------------------

import { Dataset, cellIdx } from './generate';
import {
  HNode, LAST_ACTUAL, LATEST_VINTAGE, NQ, VINTAGES, Vintage, vFirstTarget,
  vLastTarget, qLabel,
} from './model';

/** Scenario selector: a concrete layer, or the actual->latest-forecast blend. */
export type LayerSel =
  | { kind: 'actual' }
  | { kind: 'vintage'; v: number }
  | { kind: 'blend' };

export const selLabel = (sel: LayerSel): string =>
  sel.kind === 'actual' ? 'Actuals' :
  sel.kind === 'blend' ? `Actuals + ${VINTAGES[LATEST_VINTAGE].short} RF` :
  `${VINTAGES[sel.v].label}`;

export interface SidePoint { sel: LayerSel; q: number; }

export const sideLabel = (s: SidePoint) =>
  `${qLabel(s.q)} ${s.sel.kind === 'actual' ? 'A' : s.sel.kind === 'blend' ? (s.q <= LAST_ACTUAL ? 'A' : 'F') : VINTAGES[s.sel.v].short}`;

export class Cube {
  constructor(public ds: Dataset) {}

  /** Resolve a LayerSel + quarter to a physical layer index, or null if uncovered. */
  layerFor(sel: LayerSel, q: number): number | null {
    if (sel.kind === 'actual') return q <= LAST_ACTUAL ? 0 : null;
    if (sel.kind === 'blend')
      return q <= LAST_ACTUAL ? 0 : 1 + LATEST_VINTAGE;
    const v = VINTAGES[sel.v];
    if (q < vFirstTarget(v) || q > vLastTarget(v)) return null;
    return 1 + sel.v;
  }

  /** True if this cell would be forecast-sourced under the given selector. */
  isForecast(sel: LayerSel, q: number): boolean {
    if (sel.kind === 'actual') return false;
    if (sel.kind === 'vintage') return true;
    return q > LAST_ACTUAL;
  }

  /** Aggregate value for (metric node x business node x quarter) under a scenario. */
  value(sel: LayerSel, m: HNode, b: HNode, q: number): number | null {
    const li = this.layerFor(sel, q);
    if (li === null) return null;
    const layer = this.ds.layers[li];
    const NB = this.ds.NB;
    let sum = 0;
    let any = false;
    for (const ml of m.leafIdxs) {
      for (const bl of b.leafIdxs) {
        const v = layer[cellIdx(NB, ml, bl, q)];
        if (!Number.isNaN(v)) { sum += v; any = true; }
      }
    }
    return any ? sum : null;
  }

  /** Time series across all quarters. */
  series(sel: LayerSel, m: HNode, b: HNode): (number | null)[] {
    const out: (number | null)[] = [];
    for (let q = 0; q < NQ; q++) out.push(this.value(sel, m, b, q));
    return out;
  }

  /**
   * Decompose the cell along one dimension into the children of that
   * dimension's node (the other dimension stays fixed).
   */
  breakdown(dim: 'metric' | 'business', m: HNode, b: HNode, q: number, sel: LayerSel):
    { node: HNode; value: number | null }[] {
    const kids = dim === 'metric' ? m.children : b.children;
    return kids.map((node) => ({
      node,
      value: dim === 'metric' ? this.value(sel, node, b, q) : this.value(sel, m, node, q),
    }));
  }

  /** Waterfall steps from side A to side B decomposed over `dim` children. */
  waterfall(dim: 'metric' | 'business', m: HNode, b: HNode, A: SidePoint, B: SidePoint) {
    const start = this.value(A.sel, m, b, A.q);
    const end = this.value(B.sel, m, b, B.q);
    const kids = dim === 'metric' ? m.children : b.children;
    const steps = kids.map((node) => {
      const av = dim === 'metric' ? this.value(A.sel, node, b, A.q) : this.value(A.sel, m, node, A.q);
      const bv = dim === 'metric' ? this.value(B.sel, node, b, B.q) : this.value(B.sel, m, node, B.q);
      return { node, a: av, b: bv, delta: (bv ?? 0) - (av ?? 0) };
    });
    return { start, end, steps };
  }

  /** Forecast evolution: what every vintage said about (m, b, targetQ). */
  evolution(m: HNode, b: HNode, targetQ: number):
    { vintage: Vintage; value: number | null; horizon: number }[] {
    return VINTAGES
      .filter((v) => targetQ >= vFirstTarget(v) && targetQ <= vLastTarget(v))
      .map((vintage) => ({
        vintage,
        value: this.value({ kind: 'vintage', v: vintage.idx }, m, b, targetQ),
        horizon: targetQ - vintage.madeIn,
      }));
  }

  /** Leaf-level movers between two sides, under scope (m, b), along `dim`. */
  leafMovers(dim: 'metric' | 'business', m: HNode, b: HNode, A: SidePoint, B: SidePoint, topN = 8) {
    const H = dim === 'metric' ? this.ds.metricH : this.ds.businessH;
    const scope = dim === 'metric' ? m : b;
    const rows = scope.leafIdxs.map((li) => {
      const node = H.leaves[li];
      const av = dim === 'metric' ? this.value(A.sel, node, b, A.q) : this.value(A.sel, m, node, A.q);
      const bv = dim === 'metric' ? this.value(B.sel, node, b, B.q) : this.value(B.sel, m, node, B.q);
      return { node, a: av, b: bv, delta: (bv ?? 0) - (av ?? 0) };
    });
    rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return rows.slice(0, topN);
  }
}
