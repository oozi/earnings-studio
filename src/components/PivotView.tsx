import { CSSProperties, useMemo, useState } from 'react';
import { Cube, LayerSel } from '../data/engine';
import { HNode, LAST_ACTUAL, NQ, QUARTERS, VINTAGES, qLabel } from '../data/model';
import { fmtM, fmtDelta, fmtPct, pctChange } from '../format';
import { TreeSelect } from './TreeSelect';
import { DrillDrawer, DrillCtx } from './DrillDrawer';
import { VarianceCfg, EvoCfg } from '../uiTypes';

interface Props {
  cube: Cube;
  onOpenVariance: (cfg: VarianceCfg) => void;
  onOpenEvolution: (cfg: EvoCfg) => void;
}

interface ColSpec {
  key: string;
  label: string;
  qs: number[];
  isFY: boolean;
  anyForecast: boolean;
}

const encodeSel = (s: LayerSel) => (s.kind === 'vintage' ? `v${s.v}` : s.kind);
const decodeSel = (k: string): LayerSel =>
  k === 'blend' ? { kind: 'blend' } : k === 'actual' ? { kind: 'actual' } : { kind: 'vintage', v: Number(k.slice(1)) };

/** Hierarchical pivot: tree rows x period columns, any scenario layer. */
export function PivotView({ cube, onOpenVariance, onOpenEvolution }: Props) {
  const { metricH, businessH } = cube.ds;

  const [rowDim, setRowDim] = useState<'metric' | 'business'>('metric');
  const [mScope, setMScope] = useState<HNode>(metricH.root);
  const [bScope, setBScope] = useState<HNode>(businessH.root);
  const [expandedM, setExpandedM] = useState<Set<string>>(new Set(['de', 'fre', 'frr']));
  const [expandedB, setExpandedB] = useState<Set<string>>(new Set(['bxci']));
  const [qFrom, setQFrom] = useState(8); // 1Q25
  const [qTo, setQTo] = useState(15); // 4Q26
  const [colMode, setColMode] = useState<'q' | 'fy'>('q');
  const [sel, setSel] = useState<LayerSel>({ kind: 'blend' });
  const [compareV, setCompareV] = useState<number | null>(null);
  const [display, setDisplay] = useState<'val' | 'pct'>('val');
  const [heat, setHeat] = useState(false);
  const [drill, setDrill] = useState<DrillCtx | null>(null);

  const scopeNode = rowDim === 'metric' ? mScope : bScope;
  const expanded = rowDim === 'metric' ? expandedM : expandedB;
  const setExpanded = rowDim === 'metric' ? setExpandedM : setExpandedB;

  const rows = useMemo(() => {
    const out: { node: HNode; rdepth: number }[] = [];
    const walk = (n: HNode, d: number) => {
      out.push({ node: n, rdepth: d });
      if (expanded.has(n.id)) n.children.forEach((ch) => walk(ch, d + 1));
    };
    walk(scopeNode, 0);
    return out;
  }, [scopeNode, expanded]);

  const cols = useMemo<ColSpec[]>(() => {
    if (colMode === 'q') {
      const out: ColSpec[] = [];
      for (let q = qFrom; q <= qTo; q++)
        out.push({ key: `q${q}`, label: qLabel(q), qs: [q], isFY: false, anyForecast: cube.isForecast(sel, q) });
      return out;
    }
    const out: ColSpec[] = [];
    for (let y = QUARTERS[qFrom].year; y <= QUARTERS[qTo].year; y++) {
      const qs = QUARTERS.filter((x) => x.year === y).map((x) => x.idx);
      const anyForecast = qs.some((q) => cube.isForecast(sel, q));
      out.push({ key: `fy${y}`, label: `FY${String(y).slice(2)}${anyForecast ? 'E' : ''}`, qs, isFY: true, anyForecast });
    }
    return out;
  }, [colMode, qFrom, qTo, sel, cube]);

  /** Aggregate a row node over a set of quarters; FY columns require full coverage. */
  const valueAt = (s: LayerSel, rowNode: HNode, qs: number[], strict: boolean): number | null => {
    let sum = 0;
    let got = false;
    for (const q of qs) {
      const v = rowDim === 'metric' ? cube.value(s, rowNode, bScope, q) : cube.value(s, mScope, rowNode, q);
      if (v === null) {
        if (strict) return null;
        continue;
      }
      sum += v;
      got = true;
    }
    return got ? sum : null;
  };

  const heatStyle = (cur: number | null, prev: number | null): CSSProperties | undefined => {
    if (!heat || display !== 'val') return undefined;
    const pc = pctChange(prev, cur);
    if (pc === null) return undefined;
    const a = (Math.min(Math.abs(pc), 0.15) / 0.15) * 0.22;
    return { background: pc >= 0 ? `rgba(13,138,94,${a})` : `rgba(192,68,56,${a})` };
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setRange = (a: number, b: number) => {
    setQFrom(a);
    setQTo(b);
  };

  const exportCsv = () => {
    const header = ['Line', ...cols.map((c) => c.label), 'Sum'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const vals = cols.map((c) => {
        const v = valueAt(sel, r.node, c.qs, c.isFY);
        return v === null ? '' : v.toFixed(2);
      });
      let tot = 0;
      let got = false;
      for (const c of cols) {
        const v = valueAt(sel, r.node, c.qs, c.isFY);
        if (v !== null) {
          tot += v;
          got = true;
        }
      }
      const name = `${'  '.repeat(r.rdepth)}${r.node.name}`.replace(/"/g, '""');
      lines.push([`"${name}"`, ...vals, got ? tot.toFixed(2) : ''].join(','));
    }
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bxci_pivot_${rowDim}_${encodeSel(sel)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cellBadge = (c: ColSpec) => (c.anyForecast || sel.kind === 'vintage' ? 'F' : 'A');

  return (
    <div className="view">
      <div className="panel">
        <div className="toolbar">
          <div className="ctl">
            <span className="ctl-label">Rows</span>
            <div className="seg">
              <button className={rowDim === 'metric' ? 'on' : ''} onClick={() => setRowDim('metric')}>
                Metric tree
              </button>
              <button className={rowDim === 'business' ? 'on' : ''} onClick={() => setRowDim('business')}>
                Business tree
              </button>
            </div>
          </div>
          <TreeSelect
            hierarchy={metricH}
            value={mScope}
            onChange={setMScope}
            label={rowDim === 'metric' ? 'Metric (rows from)' : 'Metric (slice)'}
          />
          <TreeSelect
            hierarchy={businessH}
            value={bScope}
            onChange={setBScope}
            label={rowDim === 'business' ? 'Business (rows from)' : 'Business (slice)'}
          />
          <div className="ctl">
            <span className="ctl-label">Scenario</span>
            <select value={encodeSel(sel)} onChange={(e) => setSel(decodeSel(e.target.value))}>
              <option value="blend">Actuals + {VINTAGES[VINTAGES.length - 1].short} RF</option>
              <option value="actual">Actuals only</option>
              <optgroup label="Single forecast vintage">
                {VINTAGES.map((v) => (
                  <option key={v.idx} value={`v${v.idx}`}>
                    {v.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="ctl">
            <span className="ctl-label">Compare to</span>
            <select
              value={compareV === null ? '' : String(compareV)}
              onChange={(e) => setCompareV(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">—</option>
              {VINTAGES.map((v) => (
                <option key={v.idx} value={v.idx}>
                  Δ vs {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="toolbar">
          <div className="ctl">
            <span className="ctl-label">Columns</span>
            <div className="seg">
              <button className={colMode === 'q' ? 'on' : ''} onClick={() => setColMode('q')}>
                Quarters
              </button>
              <button className={colMode === 'fy' ? 'on' : ''} onClick={() => setColMode('fy')}>
                Fiscal years
              </button>
            </div>
          </div>
          <div className="ctl">
            <span className="ctl-label">From</span>
            <select value={qFrom} onChange={(e) => setQFrom(Math.min(Number(e.target.value), qTo))}>
              {QUARTERS.map((q) => (
                <option key={q.idx} value={q.idx}>
                  {qLabel(q.idx)}
                </option>
              ))}
            </select>
          </div>
          <div className="ctl">
            <span className="ctl-label">To</span>
            <select value={qTo} onChange={(e) => setQTo(Math.max(Number(e.target.value), qFrom))}>
              {QUARTERS.map((q) => (
                <option key={q.idx} value={q.idx}>
                  {qLabel(q.idx)}
                </option>
              ))}
            </select>
          </div>
          <div className="ctl presets">
            <span className="ctl-label">Presets</span>
            <div>
              <button className="btn sm" onClick={() => setRange(4, 11)}>
                FY24–25
              </button>
              <button className="btn sm" onClick={() => setRange(8, 15)}>
                1Q25–4Q26
              </button>
              <button className="btn sm" onClick={() => setRange(12, 19)}>
                FY26–27
              </button>
              <button className="btn sm" onClick={() => setRange(0, 19)}>
                All
              </button>
            </div>
          </div>
          <div className="ctl">
            <span className="ctl-label">Show</span>
            <div className="seg">
              <button className={display === 'val' ? 'on' : ''} onClick={() => setDisplay('val')}>
                $M
              </button>
              <button className={display === 'pct' ? 'on' : ''} onClick={() => setDisplay('pct')}>
                % of parent
              </button>
            </div>
          </div>
          <label className="ctl check">
            <input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} />
            <span>Δ heat</span>
          </label>
          <button className="btn sm" onClick={exportCsv} style={{ marginLeft: 'auto' }}>
            ⭳ CSV
          </button>
        </div>

        <div className="pivot-wrap">
          <table className="pivot">
            <thead>
              <tr>
                <th className="rowhead">
                  {rowDim === 'metric' ? 'P&L line' : 'Business line'}
                  <span className="th-note">{display === 'val' ? '$M' : '% of parent'}</span>
                </th>
                {cols.map((c) => (
                  <th key={c.key}>
                    {c.label} <span className={`badge ${cellBadge(c) === 'F' ? 'badge-f' : 'badge-a'}`}>{cellBadge(c)}</span>
                  </th>
                ))}
                <th className="sumcol">Σ range</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isScope = r.node.id === scopeNode.id;
                let sum = 0;
                let sumGot = false;
                return (
                  <tr key={r.node.id} className={isScope ? 'scope-row' : ''}>
                    <td className="rowhead">
                      <div className="rowhead-in" style={{ paddingLeft: r.rdepth * 16 }}>
                        {r.node.children.length > 0 ? (
                          <button className="caret" onClick={() => toggle(r.node.id)}>
                            {expanded.has(r.node.id) ? '▾' : '▸'}
                          </button>
                        ) : (
                          <span className="caret empty" />
                        )}
                        <span
                          className={`rowname${r.node.contra ? ' contra' : ''}`}
                          style={{ fontWeight: r.node.children.length > 0 ? (r.rdepth === 0 ? 700 : 600) : 400 }}
                          title={r.node.path}
                          onClick={() => r.node.children.length > 0 && toggle(r.node.id)}
                        >
                          {r.node.name}
                        </span>
                      </div>
                    </td>
                    {cols.map((c) => {
                      const v = valueAt(sel, r.node, c.qs, c.isFY);
                      if (v !== null) {
                        sum += v;
                        sumGot = true;
                      }
                      const prevQs = c.isFY ? c.qs.map((q) => q - 4) : [c.qs[0] - 1];
                      const prev = prevQs[0] < 0 ? null : valueAt(sel, r.node, prevQs, c.isFY);
                      const isFc = c.isFY ? c.anyForecast : cube.isForecast(sel, c.qs[0]);
                      let content: string;
                      if (display === 'pct') {
                        if (isScope) content = v === null ? '—' : '100%';
                        else {
                          const pv = r.node.parent ? valueAt(sel, r.node.parent, c.qs, c.isFY) : null;
                          content = pv === null || v === null || Math.abs(pv) < 1 ? '—' : fmtPct(v / pv, 1, false);
                        }
                      } else content = fmtM(v);
                      let cmp: JSX.Element | null = null;
                      if (compareV !== null && display === 'val') {
                        const ref = valueAt({ kind: 'vintage', v: compareV }, r.node, c.qs, true);
                        const dv = v === null || ref === null ? null : v - ref;
                        // Values are signed (expenses negative), so +Δ always lifts DE.
                        const fav = dv === null ? null : dv >= 0;
                        cmp = (
                          <div className={`cellcmp ${fav === null ? '' : fav ? 'pos' : 'neg'}`}>
                            {dv === null ? '·' : fmtDelta(dv, 0)}
                          </div>
                        );
                      }
                      return (
                        <td
                          key={c.key}
                          className={`num${isFc ? ' fc' : ''}${colMode === 'q' ? ' drillable' : ''}`}
                          style={heatStyle(v, prev)}
                          title={colMode === 'q' ? 'Click to inspect' : undefined}
                          onClick={() =>
                            colMode === 'q' &&
                            setDrill({
                              m: rowDim === 'metric' ? r.node : mScope,
                              b: rowDim === 'business' ? r.node : bScope,
                              q: c.qs[0],
                              sel,
                              dim: rowDim === 'metric' ? 'business' : 'metric',
                            })
                          }
                        >
                          <div className="cellmain">{content}</div>
                          {cmp}
                        </td>
                      );
                    })}
                    <td className="num sumcol">{display === 'val' ? fmtM(sumGot ? sum : null) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-note">
          USD millions; expenses shown as negatives in parentheses. Shaded italic cells are forecast-sourced. Click any
          quarter cell to inspect its composition, drivers and trend.
        </div>
      </div>

      {drill && (
        <DrillDrawer
          cube={cube}
          ctx={drill}
          onClose={() => setDrill(null)}
          onOpenVariance={onOpenVariance}
          onOpenEvolution={onOpenEvolution}
        />
      )}
    </div>
  );
}
