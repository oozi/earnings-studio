import { useEffect, useMemo, useState } from 'react';
import { Cube, LayerSel, selLabel } from '../data/engine';
import { HNode, LAST_ACTUAL, NQ, qLabel, qLong } from '../data/model';
import { colorFor, treemapOption, ACCENT, INK, AXIS_LABEL, SPLIT_LINE, TOOLTIP_STYLE } from '../chartTheme';
import { fmtM, fmtDelta, fmtPct } from '../format';
import { EChart } from './EChart';
import { VarianceCfg, EvoCfg } from '../uiTypes';

export interface DrillCtx {
  m: HNode;
  b: HNode;
  q: number;
  sel: LayerSel;
  dim: 'metric' | 'business'; // initial decomposition dimension
}

interface Props {
  cube: Cube;
  ctx: DrillCtx;
  onClose: () => void;
  onOpenVariance: (cfg: VarianceCfg) => void;
  onOpenEvolution: (cfg: EvoCfg) => void;
}

/** Right-hand inspector: decompose a single number, see its trend and movers. */
export function DrillDrawer({ cube, ctx, onClose, onOpenVariance, onOpenEvolution }: Props) {
  const [c, setC] = useState<DrillCtx>(ctx);
  const [view, setView] = useState<'bars' | 'treemap'>('bars');
  useEffect(() => setC(ctx), [ctx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const value = cube.value(c.sel, c.m, c.b, c.q);
  const isFc = cube.isForecast(c.sel, c.q);
  const scopeNode = c.dim === 'business' ? c.b : c.m;

  const kids = useMemo(
    () =>
      cube
        .breakdown(c.dim, c.m, c.b, c.q, c.sel)
        .slice()
        .sort((x, y) => Math.abs(y.value ?? 0) - Math.abs(x.value ?? 0)),
    [cube, c],
  );
  const maxAbs = Math.max(...kids.map((k) => Math.abs(k.value ?? 0)), 1e-9);

  const treemap = useMemo(() => {
    const H = c.dim === 'business' ? cube.ds.businessH : cube.ds.metricH;
    const leaves = scopeNode.leafIdxs.map((i) => H.leaves[i]);
    const items = leaves
      .map((leaf) => ({
        leaf,
        v: c.dim === 'business' ? cube.value(c.sel, c.m, leaf, c.q) : cube.value(c.sel, leaf, c.b, c.q),
      }))
      .filter((x) => (x.v ?? 0) > 0)
      .map((x) => ({
        name: x.leaf.short,
        value: x.v as number,
        color: colorFor(x.leaf, c.dim),
        pathLabel: x.leaf.path,
      }));
    const omitted = leaves.length - items.length;
    return { option: treemapOption(items), omitted };
  }, [cube, c, scopeNode]);

  const trendOption = useMemo(() => {
    const actual = cube.series({ kind: 'actual' }, c.m, c.b);
    const fc: (number | null)[] = new Array(NQ).fill(null);
    if (c.sel.kind === 'vintage') {
      for (let q = 0; q < NQ; q++) fc[q] = cube.value(c.sel, c.m, c.b, q);
    } else {
      for (let q = LAST_ACTUAL; q < NQ; q++) fc[q] = cube.value({ kind: 'blend' }, c.m, c.b, q);
    }
    return {
      animationDuration: 250,
      tooltip: { trigger: 'axis', ...TOOLTIP_STYLE, valueFormatter: (v: any) => fmtM(v) },
      grid: { left: 8, right: 10, top: 12, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: Array.from({ length: NQ }, (_, i) => qLabel(i)),
        axisLabel: { ...AXIS_LABEL, fontSize: 9.5, interval: 3 },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#cfd8e0' } },
      },
      yAxis: { type: 'value', scale: true, splitLine: SPLIT_LINE, axisLabel: { ...AXIS_LABEL, fontSize: 9.5 } },
      series: [
        {
          name: 'Actual', type: 'line', data: actual, symbol: 'circle', symbolSize: 3,
          lineStyle: { color: INK, width: 2.2 }, itemStyle: { color: INK },
          markLine: {
            symbol: 'none', silent: true,
            lineStyle: { color: '#b8814a', type: 'dashed' },
            label: { formatter: qLabel(c.q), fontSize: 9.5, color: '#b8814a', position: 'insideEndTop' },
            data: [{ xAxis: c.q }],
          },
        },
        {
          name: c.sel.kind === 'vintage' ? selLabel(c.sel) : 'Forecast', type: 'line', data: fc,
          symbol: 'none', lineStyle: { color: ACCENT, width: 2, type: 'dashed' }, itemStyle: { color: ACCENT },
        },
      ],
    };
  }, [cube, c]);

  const prevCovered = c.q > 0 && cube.layerFor(c.sel, c.q - 1) !== null;
  const movers = useMemo(
    () =>
      prevCovered
        ? cube.leafMovers(c.dim, c.m, c.b, { sel: c.sel, q: c.q - 1 }, { sel: c.sel, q: c.q }, 6)
        : [],
    [cube, c, prevCovered],
  );
  const maxMove = Math.max(...movers.map((m) => Math.abs(m.delta)), 1e-9);

  const upBtn = (node: HNode, apply: (n: HNode) => void) =>
    node.parent ? (
      <button className="chip-up" title={`Up to ${node.parent.short}`} onClick={() => apply(node.parent!)}>
        ↑
      </button>
    ) : null;

  const favorable = (delta: number, contra: boolean) => (delta >= 0) !== contra;

  return (
    <div className="drawer">
      <div className="drawer-head">
        <div className="drawer-title-row">
          <div>
            <div className="drawer-value">
              {fmtM(value)} <span className="unit">$M</span>
              <span className={`badge ${isFc ? 'badge-f' : 'badge-a'}`}>{isFc ? 'FORECAST' : 'ACTUAL'}</span>
            </div>
            <div className="drawer-sub">
              {qLong(c.q)} · {selLabel(c.sel)}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="drawer-chips">
          <span className="chip" title={c.m.path}>
            <span className="chip-k">Metric</span> {c.m.short} {upBtn(c.m, (n) => setC({ ...c, m: n }))}
          </span>
          <span className="chip" title={c.b.path}>
            <span className="chip-k">Business</span> {c.b.short} {upBtn(c.b, (n) => setC({ ...c, b: n }))}
          </span>
        </div>
      </div>

      <div className="drawer-section">
        <div className="section-head">
          <h4>Where does it come from?</h4>
          <div className="seg mini">
            <button className={c.dim === 'business' ? 'on' : ''} onClick={() => setC({ ...c, dim: 'business' })}>
              By business
            </button>
            <button className={c.dim === 'metric' ? 'on' : ''} onClick={() => setC({ ...c, dim: 'metric' })}>
              By metric
            </button>
          </div>
          <div className="seg mini">
            <button className={view === 'bars' ? 'on' : ''} onClick={() => setView('bars')}>
              Bars
            </button>
            <button className={view === 'treemap' ? 'on' : ''} onClick={() => setView('treemap')}>
              Treemap
            </button>
          </div>
        </div>

        {kids.length === 0 && <div className="note">At leaf level along this dimension — no further breakdown.</div>}

        {view === 'bars' && kids.length > 0 && (
          <div className="bars">
            {kids.map((k) => {
              const share = value && Math.abs(value) > 1 && k.value !== null ? k.value / value : null;
              const clickable = k.node.children.length > 0;
              return (
                <div
                  key={k.node.id}
                  className={`bar-row${clickable ? ' clickable' : ''}`}
                  title={clickable ? `Drill into ${k.node.short}` : k.node.path}
                  onClick={() => clickable && setC(c.dim === 'business' ? { ...c, b: k.node } : { ...c, m: k.node })}
                >
                  <span className="bar-name">{k.node.short}</span>
                  <span className="bar-track">
                    <span
                      className="bar-fill"
                      style={{
                        width: `${(Math.abs(k.value ?? 0) / maxAbs) * 100}%`,
                        background: (k.value ?? 0) >= 0 ? colorFor(k.node, c.dim) : '#c04438',
                      }}
                    />
                  </span>
                  <span className="bar-val">{fmtM(k.value)}</span>
                  <span className="bar-share">{share === null ? '' : fmtPct(share, 0, false)}</span>
                </div>
              );
            })}
          </div>
        )}

        {view === 'treemap' && kids.length > 0 && (
          <>
            <EChart option={treemap.option} height={230} />
            {treemap.omitted > 0 && <div className="note">{treemap.omitted} zero/negative item(s) not shown in treemap.</div>}
          </>
        )}
      </div>

      <div className="drawer-section">
        <div className="section-head">
          <h4>Trend</h4>
        </div>
        <EChart option={trendOption} height={160} />
      </div>

      {prevCovered && movers.length > 0 && (
        <div className="drawer-section">
          <div className="section-head">
            <h4>Top movers vs {qLabel(c.q - 1)}</h4>
          </div>
          <div className="movers">
            {movers.map((mv) => {
              const contra = c.dim === 'metric' ? mv.node.contra : c.m.contra;
              const fav = favorable(mv.delta, contra);
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
      )}

      <div className="drawer-actions">
        {c.q > 0 && (
          <button
            className="btn"
            onClick={() =>
              onOpenVariance({
                dim: c.dim,
                mId: c.m.id,
                bId: c.b.id,
                A: { sel: c.sel, q: c.q - 1 },
                B: { sel: c.sel, q: c.q },
              })
            }
          >
            Bridge vs {qLabel(c.q - 1)} →
          </button>
        )}
        <button className="btn" onClick={() => onOpenEvolution({ mId: c.m.id, bId: c.b.id, targetQ: c.q })}>
          Forecast evolution →
        </button>
      </div>
    </div>
  );
}
