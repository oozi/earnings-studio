import { useEffect, useMemo, useState } from 'react';
import { Cube, LayerSel, SidePoint, sideLabel } from '../data/engine';
import { HNode, LAST_ACTUAL, QUARTERS, VINTAGES, qLabel, vFirstTarget, vLastTarget } from '../data/model';
import { waterfallOption } from '../chartTheme';
import { fmtM, fmtDelta, fmtPct, pctChange } from '../format';
import { EChart } from './EChart';
import { TreeSelect } from './TreeSelect';
import { VarianceCfg } from '../uiTypes';

interface Props {
  cube: Cube;
  request: { cfg: VarianceCfg; id: number } | null;
}

const encodeSel = (s: LayerSel) => (s.kind === 'vintage' ? `v${s.v}` : s.kind);
const decodeSel = (k: string): LayerSel =>
  k === 'blend' ? { kind: 'blend' } : k === 'actual' ? { kind: 'actual' } : { kind: 'vintage', v: Number(k.slice(1)) };

function SideEditor({ tag, side, onChange }: { tag: 'A' | 'B'; side: SidePoint; onChange: (s: SidePoint) => void }) {
  return (
    <div className="side">
      <span className={`side-tag ${tag === 'A' ? 'a' : 'b'}`}>{tag}</span>
      <select value={side.q} onChange={(e) => onChange({ ...side, q: Number(e.target.value) })}>
        {QUARTERS.map((q) => (
          <option key={q.idx} value={q.idx}>
            {qLabel(q.idx)}
          </option>
        ))}
      </select>
      <select value={encodeSel(side.sel)} onChange={(e) => onChange({ ...side, sel: decodeSel(e.target.value) })}>
        <option value="actual">Actual</option>
        <option value="blend">Actuals+RF</option>
        <optgroup label="Forecast vintage">
          {VINTAGES.map((v) => (
            <option key={v.idx} value={`v${v.idx}`}>
              {v.label}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

/** A-to-B bridge: drillable waterfall + contribution table + leaf movers. */
export function VarianceView({ cube, request }: Props) {
  const { metricH, businessH } = cube.ds;

  const [dim, setDim] = useState<'metric' | 'business'>('business');
  const [m, setM] = useState<HNode>(metricH.root);
  const [b, setB] = useState<HNode>(businessH.root);
  const [A, setA] = useState<SidePoint>({ sel: { kind: 'actual' }, q: LAST_ACTUAL - 1 });
  const [B, setB2] = useState<SidePoint>({ sel: { kind: 'actual' }, q: LAST_ACTUAL });

  useEffect(() => {
    if (!request) return;
    const { cfg } = request;
    setDim(cfg.dim);
    setM(metricH.byId.get(cfg.mId) ?? metricH.root);
    setB(businessH.byId.get(cfg.bId) ?? businessH.root);
    setA(cfg.A);
    setB2(cfg.B);
  }, [request, metricH, businessH]);

  const coverA = cube.layerFor(A.sel, A.q) !== null;
  const coverB = cube.layerFor(B.sel, B.q) !== null;

  const wf = useMemo(() => {
    if (!coverA || !coverB) return null;
    const raw = cube.waterfall(dim, m, b, A, B);
    if (raw.start === null || raw.end === null) return null;
    const steps =
      dim === 'business' ? raw.steps.slice().sort((x, y) => y.delta - x.delta) : raw.steps;
    return { ...raw, steps };
  }, [cube, dim, m, b, A, B, coverA, coverB]);

  const option = useMemo(() => {
    if (!wf) return null;
    return waterfallOption({
      startLabel: sideLabel(A),
      startValue: wf.start!,
      endLabel: sideLabel(B),
      endValue: wf.end!,
      steps: wf.steps.map((s) => ({ name: s.node.short, delta: s.delta, a: s.a, b: s.b })),
    });
  }, [wf, A, B]);

  const descend = (node: HNode) => {
    if (node.isLeaf) return;
    if (dim === 'business') setB(node);
    else setM(node);
  };

  const onEvents = useMemo(
    () => ({
      click: (p: any) => {
        if (p.seriesName !== 'wfmain' || !wf) return;
        const i = p.dataIndex as number;
        if (i >= 1 && i <= wf.steps.length) descend(wf.steps[i - 1].node);
      },
    }),
    [wf, dim],
  );

  const scopeNode = dim === 'business' ? b : m;
  const crumbs = useMemo(() => {
    const chain: HNode[] = [];
    let cur: HNode | null = scopeNode;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent;
    }
    return chain;
  }, [scopeNode]);

  const movers = useMemo(
    () => (coverA && coverB ? cube.leafMovers(dim, m, b, A, B, 10) : []),
    [cube, dim, m, b, A, B, coverA, coverB],
  );
  const maxMove = Math.max(...movers.map((x) => Math.abs(x.delta)), 1e-9);

  const presets: { label: string; apply: () => void }[] = [
    {
      label: `QoQ  ${qLabel(LAST_ACTUAL)} vs ${qLabel(LAST_ACTUAL - 1)}`,
      apply: () => {
        setA({ sel: { kind: 'actual' }, q: LAST_ACTUAL - 1 });
        setB2({ sel: { kind: 'actual' }, q: LAST_ACTUAL });
      },
    },
    {
      label: `YoY  ${qLabel(LAST_ACTUAL)} vs ${qLabel(LAST_ACTUAL - 4)}`,
      apply: () => {
        setA({ sel: { kind: 'actual' }, q: LAST_ACTUAL - 4 });
        setB2({ sel: { kind: 'actual' }, q: LAST_ACTUAL });
      },
    },
    {
      label: `${qLabel(LAST_ACTUAL)}: Budget → Actual`,
      apply: () => {
        setA({ sel: { kind: 'vintage', v: 8 }, q: LAST_ACTUAL }); // Nov-25 = FY26 Budget
        setB2({ sel: { kind: 'actual' }, q: LAST_ACTUAL });
      },
    },
    {
      label: '4Q25 surprise: Aug-25 RF → Actual',
      apply: () => {
        setA({ sel: { kind: 'vintage', v: 7 }, q: 11 });
        setB2({ sel: { kind: 'actual' }, q: 11 });
      },
    },
    {
      label: '4Q26 outlook: Feb-26 → May-26 RF',
      apply: () => {
        setA({ sel: { kind: 'vintage', v: 9 }, q: 15 });
        setB2({ sel: { kind: 'vintage', v: 10 }, q: 15 });
      },
    },
  ];

  const net = wf ? wf.end! - wf.start! : null;
  const biggest = wf && wf.steps.length ? wf.steps.reduce((p, c) => (Math.abs(c.delta) > Math.abs(p.delta) ? c : p)) : null;

  const uncovered = (side: SidePoint) => {
    if (side.sel.kind === 'actual') return `actuals end at ${qLabel(LAST_ACTUAL)}`;
    if (side.sel.kind === 'vintage') {
      const v = VINTAGES[side.sel.v];
      return `${v.short} covers ${qLabel(vFirstTarget(v))}–${qLabel(vLastTarget(v))}`;
    }
    return '';
  };

  return (
    <div className="view">
      <div className="panel">
        <div className="toolbar">
          <div className="ctl">
            <span className="ctl-label">Compare (A → B)</span>
            <div className="sides">
              <SideEditor tag="A" side={A} onChange={setA} />
              <span className="sides-arrow">→</span>
              <SideEditor tag="B" side={B} onChange={setB2} />
            </div>
          </div>
          <div className="ctl">
            <span className="ctl-label">Decompose by</span>
            <div className="seg">
              <button className={dim === 'business' ? 'on' : ''} onClick={() => setDim('business')}>
                Business line
              </button>
              <button className={dim === 'metric' ? 'on' : ''} onClick={() => setDim('metric')}>
                Metric
              </button>
            </div>
          </div>
          <TreeSelect hierarchy={metricH} value={m} onChange={setM} label={dim === 'metric' ? 'Metric (drill scope)' : 'Metric (slice)'} />
          <TreeSelect hierarchy={businessH} value={b} onChange={setB} label={dim === 'business' ? 'Business (drill scope)' : 'Business (slice)'} />
        </div>
        <div className="toolbar">
          <div className="ctl presets">
            <span className="ctl-label">Presets</span>
            <div>
              {presets.map((p) => (
                <button key={p.label} className="btn sm" onClick={p.apply}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {(!coverA || !coverB) && (
          <div className="warn">
            {!coverA && (
              <div>
                Side A ({sideLabel(A)}) has no data — {uncovered(A)}.
              </div>
            )}
            {!coverB && (
              <div>
                Side B ({sideLabel(B)}) has no data — {uncovered(B)}.
              </div>
            )}
          </div>
        )}

        {wf && (
          <>
            <div className="crumbs">
              <span className="ctl-label" style={{ marginRight: 6 }}>
                {dim === 'business' ? 'Business drill path' : 'Metric drill path'}
              </span>
              {crumbs.map((cnode, i) => (
                <span key={cnode.id}>
                  {i > 0 && <span className="crumb-sep">›</span>}
                  <button
                    className={`crumb${cnode.id === scopeNode.id ? ' current' : ''}`}
                    onClick={() => (dim === 'business' ? setB(cnode) : setM(cnode))}
                  >
                    {cnode.short}
                  </button>
                </span>
              ))}
              <span className="note" style={{ marginLeft: 10 }}>
                click a bar to drill in
              </span>
            </div>

            {net !== null && biggest && (
              <div className="insight">
                <b>
                  {m.short} · {b.short}
                </b>
                : {net >= 0 ? 'increased' : 'decreased'} <b>{fmtDelta(net)}</b> ({fmtPct(pctChange(wf.start, wf.end))}) from{' '}
                {sideLabel(A)} to {sideLabel(B)}. Largest driver: <b>{biggest.node.short}</b> ({fmtDelta(biggest.delta)}).
              </div>
            )}

            <EChart option={option} height={360} onEvents={onEvents} />

            <div className="vartables">
              <div>
                <h4 className="tbl-title">Contribution detail</h4>
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>{dim === 'business' ? 'Business line' : 'P&L line'}</th>
                      <th>{sideLabel(A)}</th>
                      <th>{sideLabel(B)}</th>
                      <th>Δ</th>
                      <th>Δ%</th>
                      <th>share of net Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wf.steps.map((s) => {
                      const contra = dim === 'metric' ? s.node.contra : m.contra;
                      const fav = (s.delta >= 0) !== contra;
                      return (
                        <tr key={s.node.id}>
                          <td>
                            <span
                              className={`namelink${s.node.isLeaf ? ' leaf' : ''}`}
                              onClick={() => descend(s.node)}
                              title={s.node.isLeaf ? s.node.path : `Drill into ${s.node.short}`}
                            >
                              {s.node.short}
                            </span>
                          </td>
                          <td className="num">{fmtM(s.a)}</td>
                          <td className="num">{fmtM(s.b)}</td>
                          <td className={`num ${fav ? 'pos' : 'neg'}`}>{fmtDelta(s.delta)}</td>
                          <td className="num">{fmtPct(pctChange(s.a, s.b))}</td>
                          <td className="num">
                            {net !== null && Math.abs(net) > 0.5 ? fmtPct(s.delta / net, 0, false) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div>
                <h4 className="tbl-title">Top fund / leaf movers</h4>
                <div className="movers">
                  {movers.map((mv) => {
                    const contra = dim === 'metric' ? mv.node.contra : m.contra;
                    const fav = (mv.delta >= 0) !== contra;
                    return (
                      <div key={mv.node.id} className="mover-row" title={mv.node.path}>
                        <span className="bar-name">{mv.node.short}</span>
                        <span className="mv-track">
                          <span className="mv-zero" />
                          <span
                            className="mv-fill"
                            style={{
                              width: `${(Math.abs(mv.delta) / maxMove) * 50}%`,
                              left: mv.delta >= 0 ? '50%' : undefined,
                              right: mv.delta < 0 ? '50%' : undefined,
                              background: fav ? '#0d8a5e' : '#c04438',
                            }}
                          />
                        </span>
                        <span className={`bar-val ${fav ? 'pos' : 'neg'}`}>{fmtDelta(mv.delta)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
