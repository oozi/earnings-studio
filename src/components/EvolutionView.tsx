import { useEffect, useMemo, useState } from 'react';
import { Cube } from '../data/engine';
import { HNode, LAST_ACTUAL, NQ, QUARTERS, VINTAGES, qLabel, qLong } from '../data/model';
import { ACCENT, INK, AXIS_LABEL, SPLIT_LINE, TOOLTIP_STYLE, vintageColor } from '../chartTheme';
import { fmtM, fmtDelta, fmtPct } from '../format';
import { EChart } from './EChart';
import { TreeSelect } from './TreeSelect';
import { EvoCfg } from '../uiTypes';

interface Props {
  cube: Cube;
  request: { cfg: EvoCfg; id: number } | null;
}

/** How each forecast vintage saw the future, and how they converged on actuals. */
export function EvolutionView({ cube, request }: Props) {
  const { metricH, businessH } = cube.ds;

  const [m, setM] = useState<HNode>(metricH.byId.get('fre') ?? metricH.root);
  const [b, setB] = useState<HNode>(businessH.root);
  const [targetQ, setTargetQ] = useState(11); // 4Q25 — the crystallization story

  useEffect(() => {
    if (!request) return;
    setM(metricH.byId.get(request.cfg.mId) ?? metricH.root);
    setB(businessH.byId.get(request.cfg.bId) ?? businessH.root);
    setTargetQ(request.cfg.targetQ);
  }, [request, metricH, businessH]);

  const fanOption = useMemo(() => {
    const xLabels = Array.from({ length: NQ }, (_, i) => qLabel(i));
    const actual = cube.series({ kind: 'actual' }, m, b);
    const series: any[] = VINTAGES.map((v) => ({
      name: v.short,
      type: 'line',
      data: cube.series({ kind: 'vintage', v: v.idx }, m, b),
      symbol: 'circle',
      symbolSize: 3.5,
      showSymbol: false,
      z: 2 + v.idx * 0.1,
      lineStyle: {
        width: v.idx === VINTAGES.length - 1 ? 2.6 : 1.3,
        color: vintageColor(v.idx, VINTAGES.length),
      },
      itemStyle: { color: vintageColor(v.idx, VINTAGES.length) },
      emphasis: { focus: 'series', lineStyle: { width: 3 } },
    }));
    series.push({
      name: 'Actual',
      type: 'line',
      data: actual,
      symbol: 'circle',
      symbolSize: 4.5,
      z: 20,
      lineStyle: { width: 3, color: INK },
      itemStyle: { color: INK },
      emphasis: { focus: 'series' },
      markLine: {
        symbol: 'none',
        silent: true,
        data: [
          {
            xAxis: targetQ,
            lineStyle: { color: '#d9971f', type: 'solid', width: 1.5 },
            label: { formatter: `target ${qLabel(targetQ)}`, fontSize: 10, color: '#b07a10', position: 'insideEndTop' },
          },
          {
            xAxis: LAST_ACTUAL,
            lineStyle: { color: '#9aa8b7', type: 'dashed' },
            label: { formatter: 'last actual', fontSize: 10, color: '#8894a2', position: 'insideEndBottom' },
          },
        ],
      },
    });
    return {
      animationDuration: 300,
      tooltip: {
        trigger: 'axis',
        ...TOOLTIP_STYLE,
        valueFormatter: (v: any) => fmtM(v),
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { fontSize: 10.5, color: '#5b6873' },
        itemWidth: 14,
        itemHeight: 8,
      },
      grid: { left: 8, right: 16, top: 34, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { ...AXIS_LABEL, interval: 1 },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#cfd8e0' } },
        triggerEvent: true,
      },
      yAxis: { type: 'value', scale: true, splitLine: SPLIT_LINE, axisLabel: { ...AXIS_LABEL } },
      series,
    };
  }, [cube, m, b, targetQ]);

  const fanEvents = useMemo(
    () => ({
      click: (p: any) => {
        // Click a point (or an x-axis label) to re-target the convergence panel.
        if (p.componentType === 'series' && typeof p.dataIndex === 'number') setTargetQ(p.dataIndex);
        else if (p.componentType === 'xAxis' && typeof p.value === 'string') {
          const i = Array.from({ length: NQ }, (_, k) => qLabel(k)).indexOf(p.value);
          if (i >= 0) setTargetQ(i);
        }
      },
    }),
    [],
  );

  const evo = useMemo(() => cube.evolution(m, b, targetQ), [cube, m, b, targetQ]);
  const actualVal = targetQ <= LAST_ACTUAL ? cube.value({ kind: 'actual' }, m, b, targetQ) : null;

  const convOption = useMemo(() => {
    const marks: any[] = [];
    if (actualVal !== null)
      marks.push({
        yAxis: actualVal,
        lineStyle: { color: INK, type: 'dashed', width: 1.5 },
        label: { formatter: `Actual ${fmtM(actualVal)}`, fontSize: 10.5, color: INK, position: 'insideEndTop' },
      });
    return {
      animationDuration: 300,
      tooltip: {
        trigger: 'axis',
        ...TOOLTIP_STYLE,
        valueFormatter: (v: any) => fmtM(v),
      },
      grid: { left: 8, right: 18, top: 20, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: evo.map((e) => e.vintage.short),
        axisLabel: { ...AXIS_LABEL, interval: 0, rotate: evo.length > 7 ? 30 : 0 },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#cfd8e0' } },
      },
      yAxis: { type: 'value', scale: true, splitLine: SPLIT_LINE, axisLabel: { ...AXIS_LABEL } },
      series: [
        {
          name: `Forecast for ${qLabel(targetQ)}`,
          type: 'line',
          data: evo.map((e) => e.value),
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2.5, color: ACCENT },
          itemStyle: { color: ACCENT },
          label: { show: false },
          markLine: { symbol: 'none', silent: true, data: marks },
        },
      ],
    };
  }, [evo, targetQ, actualVal]);

  const insight = useMemo(() => {
    if (actualVal === null || evo.length === 0) return null;
    const err = (v: number | null) => (v === null || actualVal === 0 ? null : (v - actualVal) / Math.abs(actualVal));
    const first = evo[0];
    const h1 = evo.find((e) => e.horizon === 1);
    const h0 = evo.find((e) => e.horizon === 0);
    const parts: string[] = [];
    parts.push(`${first.vintage.short} (${first.horizon}q out) was off by ${fmtPct(err(first.value))}`);
    if (h1) parts.push(`1 quarter out: ${fmtPct(err(h1.value))}`);
    if (h0) parts.push(`in-quarter estimate: ${fmtPct(err(h0.value))}`);
    return parts.join(' · ');
  }, [evo, actualVal]);

  return (
    <div className="view">
      <div className="panel">
        <div className="toolbar">
          <TreeSelect hierarchy={metricH} value={m} onChange={setM} label="Metric" />
          <TreeSelect hierarchy={businessH} value={b} onChange={setB} label="Business" />
          <div className="ctl">
            <span className="ctl-label">Target quarter</span>
            <select value={targetQ} onChange={(e) => setTargetQ(Number(e.target.value))}>
              {QUARTERS.map((q) => (
                <option key={q.idx} value={q.idx}>
                  {qLabel(q.idx)}
                  {q.idx <= LAST_ACTUAL ? ' (actual known)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid-evo">
          <div>
            <h3>Every vintage&apos;s view of {m.short} · {b.short}</h3>
            <div className="panel-sub">
              One line per forecast cycle (older = lighter). Bold black line = actuals. Click any point to change the
              target quarter.
            </div>
            <EChart option={fanOption} height={390} onEvents={fanEvents} />
          </div>
          <div>
            <h3>Convergence on {qLong(targetQ)}</h3>
            <div className="panel-sub">
              What each successive forecast cycle said {qLabel(targetQ)} would be
              {actualVal !== null ? ' — versus where it actually landed.' : ' (actual not yet available).'}
            </div>
            <EChart option={convOption} height={210} />
            {insight && <div className="insight">{insight}</div>}
            <table className="data">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Vintage</th>
                  <th>horizon</th>
                  <th>forecast</th>
                  <th>Δ vs actual</th>
                  <th>% err</th>
                </tr>
              </thead>
              <tbody>
                {evo.map((e) => {
                  const d = actualVal !== null && e.value !== null ? e.value - actualVal : null;
                  const pe = d !== null && actualVal !== null && Math.abs(actualVal) > 1 ? d / Math.abs(actualVal) : null;
                  return (
                    <tr key={e.vintage.idx}>
                      <td>{e.vintage.label}</td>
                      <td className="num">{e.horizon}q</td>
                      <td className="num">{fmtM(e.value)}</td>
                      <td className={`num ${d === null ? '' : d >= 0 ? 'pos' : 'neg'}`}>{fmtDelta(d)}</td>
                      <td className={`num ${pe === null ? '' : pe >= 0 ? 'pos' : 'neg'}`}>{fmtPct(pe)}</td>
                    </tr>
                  );
                })}
                {actualVal !== null && (
                  <tr className="total-row">
                    <td>Actual</td>
                    <td className="num" />
                    <td className="num">
                      <b>{fmtM(actualVal)}</b>
                    </td>
                    <td className="num" />
                    <td className="num" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
