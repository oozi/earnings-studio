import { useMemo } from 'react';
import { Cube } from '../data/engine';
import { LAST_ACTUAL, NQ, VINTAGES, qLabel, qLong } from '../data/model';
import { AXIS_LABEL, INK, SPLIT_LINE, TOOLTIP_STYLE, colorFor, treemapOption, waterfallOption } from '../chartTheme';
import { fmtM, fmtPct, pctChange } from '../format';
import { EChart } from './EChart';
import { VarianceCfg, EvoCfg } from '../uiTypes';

interface Props {
  cube: Cube;
  onOpenVariance: (cfg: VarianceCfg) => void;
  onOpenEvolution: (cfg: EvoCfg) => void;
  goPivot: () => void;
}

function Sparkline({ actual, forecast }: { actual: (number | null)[]; forecast: (number | null)[] }) {
  const w = 150, h = 38, pad = 3;
  const all = [...actual, ...forecast].filter((x): x is number => x !== null);
  const min = Math.min(...all), max = Math.max(...all);
  const x = (i: number) => pad + (i / (NQ - 1)) * (w - 2 * pad);
  const y = (v: number) => (max === min ? h / 2 : pad + (1 - (v - min) / (max - min)) * (h - 2 * pad));
  const pts = (arr: (number | null)[]) =>
    arr
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  return (
    <svg width={w} height={h} className="spark">
      <polyline points={pts(actual)} fill="none" stroke="#16232f" strokeWidth={1.7} />
      <polyline points={pts(forecast)} fill="none" stroke="#0d6e4f" strokeWidth={1.4} strokeDasharray="3 3" />
    </svg>
  );
}

export function OverviewView({ cube, onOpenVariance, onOpenEvolution, goPivot }: Props) {
  const { metricH, businessH } = cube.ds;
  const bx = businessH.root;
  const q = LAST_ACTUAL;

  const kpis = useMemo(
    () =>
      ['de', 'fre', 'frr', 'nr'].map((id) => {
        const node = metricH.byId.get(id)!;
        const cur = cube.value({ kind: 'actual' }, node, bx, q);
        const qoq = pctChange(cube.value({ kind: 'actual' }, node, bx, q - 1), cur);
        const yoy = pctChange(cube.value({ kind: 'actual' }, node, bx, q - 4), cur);
        const actual = cube.series({ kind: 'actual' }, node, bx);
        const fc: (number | null)[] = new Array(NQ).fill(null);
        for (let i = LAST_ACTUAL; i < NQ; i++) fc[i] = cube.value({ kind: 'blend' }, node, bx, i);
        return { node, cur, qoq, yoy, actual, fc };
      }),
    [cube, metricH, bx, q],
  );

  const deChart = useMemo(() => {
    const de = metricH.root;
    const fre = metricH.byId.get('fre')!;
    const blend = cube.series({ kind: 'blend' }, de, bx);
    const bars = blend.map((v, i) => ({
      value: v,
      itemStyle:
        i <= LAST_ACTUAL
          ? { color: '#265e49', borderRadius: [3, 3, 0, 0] }
          : { color: 'rgba(38,94,73,0.30)', borderColor: '#4c8a70', borderWidth: 1, borderType: 'dashed', borderRadius: [3, 3, 0, 0] },
    }));
    // Forecast dispersion band: min/max of the last four vintages.
    const lows: (number | null)[] = new Array(NQ).fill(null);
    const highs: (number | null)[] = new Array(NQ).fill(null);
    for (let i = LAST_ACTUAL + 1; i < NQ; i++) {
      const vals: number[] = [];
      for (let v = VINTAGES.length - 4; v < VINTAGES.length; v++) {
        const x = cube.value({ kind: 'vintage', v }, de, bx, i);
        if (x !== null) vals.push(x);
      }
      if (vals.length >= 2) {
        lows[i] = Math.min(...vals);
        highs[i] = Math.max(...vals);
      }
    }
    const freA = cube.series({ kind: 'actual' }, fre, bx);
    const freF: (number | null)[] = new Array(NQ).fill(null);
    for (let i = LAST_ACTUAL; i < NQ; i++) freF[i] = cube.value({ kind: 'blend' }, fre, bx, i);

    const tipSeries = new Set(['Distributable Earnings', 'Fee Related Earnings', 'FRE forecast']);
    return {
      animationDuration: 350,
      tooltip: {
        trigger: 'axis',
        ...TOOLTIP_STYLE,
        formatter: (params: any[]) => {
          const rows = params
            .filter((p) => tipSeries.has(p.seriesName) && p.value !== null && p.value !== undefined)
            .map((p) => `${p.marker} ${p.seriesName === 'FRE forecast' ? 'FRE (forecast)' : p.seriesName}: <b>${fmtM(p.value)}</b>`);
          return rows.length ? `<b>${params[0].axisValueLabel}</b><br/>${rows.join('<br/>')}` : '';
        },
      },
      legend: {
        top: 0,
        data: ['Distributable Earnings', 'Fee Related Earnings', 'RF dispersion (last 4 vintages)'],
        textStyle: { fontSize: 11, color: '#5b6873' },
      },
      grid: { left: 8, right: 14, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: Array.from({ length: NQ }, (_, i) => qLabel(i)),
        axisLabel: { ...AXIS_LABEL, interval: 1 },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#cfd8e0' } },
      },
      yAxis: { type: 'value', splitLine: SPLIT_LINE, axisLabel: { ...AXIS_LABEL } },
      series: [
        { name: 'Distributable Earnings', type: 'bar', data: bars, barWidth: '62%', z: 3 },
        {
          name: 'band-low', type: 'line', data: lows, stack: 'band', symbol: 'none',
          lineStyle: { opacity: 0 }, silent: true, showInLegend: false, tooltip: { show: false },
        },
        {
          name: 'RF dispersion (last 4 vintages)', type: 'line', symbol: 'none', stack: 'band', silent: true,
          data: highs.map((hi, i) => (hi === null || lows[i] === null ? null : hi - (lows[i] as number))),
          lineStyle: { opacity: 0 },
          areaStyle: { color: 'rgba(13,110,79,0.13)' },
          tooltip: { show: false },
          z: 1,
        },
        {
          name: 'Fee Related Earnings', type: 'line', data: freA, symbol: 'circle', symbolSize: 3.5,
          lineStyle: { color: '#1f4f7a', width: 2.4 }, itemStyle: { color: '#1f4f7a' }, z: 5,
        },
        {
          name: 'FRE forecast', type: 'line', data: freF, symbol: 'none',
          lineStyle: { color: '#1f4f7a', width: 2, type: 'dashed' }, itemStyle: { color: '#1f4f7a' },
          showInLegend: false, tooltip: { show: false }, z: 5,
        },
      ],
    };
  }, [cube, metricH, bx]);

  const treemap = useMemo(() => {
    const frr = metricH.byId.get('frr')!;
    const items = businessH.leaves
      .map((leaf) => ({ leaf, v: cube.value({ kind: 'actual' }, frr, leaf, q) }))
      .filter((x) => (x.v ?? 0) > 0)
      .map((x) => ({
        name: x.leaf.short,
        value: x.v as number,
        color: colorFor(x.leaf, 'business'),
        pathLabel: x.leaf.path,
      }));
    return treemapOption(items);
  }, [cube, metricH, businessH, q]);

  const bridge = useMemo(() => {
    const de = metricH.root;
    const wf = cube.waterfall('business', de, bx, { sel: { kind: 'actual' }, q: q - 1 }, { sel: { kind: 'actual' }, q });
    const steps = wf.steps.slice().sort((x, y) => y.delta - x.delta);
    return waterfallOption({
      startLabel: `${qLabel(q - 1)}A`,
      startValue: wf.start!,
      endLabel: `${qLabel(q)}A`,
      endValue: wf.end!,
      steps: steps.map((s) => ({ name: s.node.short, delta: s.delta, a: s.a, b: s.b })),
    });
  }, [cube, metricH, bx, q]);

  return (
    <div className="view">
      <div className="grid-kpi">
        {kpis.map((k) => (
          <div key={k.node.id} className="kpi">
            <div className="kpi-name">{k.node.name}</div>
            <div className="kpi-val">
              {fmtM(k.cur)} <span className="unit">$M</span>
            </div>
            <div className="kpi-pills">
              <span className={`pillstat ${k.qoq !== null && k.qoq >= 0 ? 'pos' : 'neg'}`}>QoQ {fmtPct(k.qoq)}</span>
              <span className={`pillstat ${k.yoy !== null && k.yoy >= 0 ? 'pos' : 'neg'}`}>YoY {fmtPct(k.yoy)}</span>
            </div>
            <Sparkline actual={k.actual} forecast={k.fc} />
            <div className="kpi-foot">{qLong(q)} actual · dashed = latest RF</div>
          </div>
        ))}
      </div>

      <div className="grid-main">
        <div className="panel span2">
          <h3>Distributable Earnings — actuals and latest reforecast</h3>
          <div className="panel-sub">
            Solid bars are actuals through {qLabel(LAST_ACTUAL)}; hollow bars are the {VINTAGES[VINTAGES.length - 1].short}{' '}
            reforecast. Shaded band shows how much the last four forecast cycles disagree.
          </div>
          <EChart option={deChart} height={300} />
        </div>

        <div className="panel">
          <h3>Where fee revenues come from — {qLabel(q)} actual</h3>
          <div className="panel-sub">
            Fee Related Revenues by fund, colored by segment.{' '}
            <span className="linklike" onClick={goPivot}>
              Open the Explorer →
            </span>
          </div>
          <EChart option={treemap} height={300} />
        </div>

        <div className="panel">
          <h3>
            DE bridge: {qLabel(q - 1)} → {qLabel(q)} by segment
          </h3>
          <div className="panel-sub">
            The 4Q25 Cap Opps IV crystallization does not repeat — Private Credit gives back its spike.{' '}
            <span
              className="linklike"
              onClick={() =>
                onOpenVariance({
                  dim: 'business',
                  mId: 'de',
                  bId: 'bxci',
                  A: { sel: { kind: 'actual' }, q: q - 1 },
                  B: { sel: { kind: 'actual' }, q },
                })
              }
            >
              Open in Variance →
            </span>
          </div>
          <EChart option={bridge} height={300} />
        </div>

        <div className="panel span2 notes">
          <h3>About this demo</h3>
          <div className="notes-grid">
            <div>
              <b>Data</b>
              <p>
                Fully synthetic, seeded (nothing real): 29 funds × 8 P&amp;L leaf lines × 20 quarters (1Q23–4Q27) × 12
                scenario layers (actuals + 11 forecast vintages) ≈ 36k facts, aggregated on the fly through both
                hierarchies.
              </p>
            </div>
            <div>
              <b>Try this</b>
              <p>
                In <i>Explore</i>, click any number to see where it comes from, then “Bridge vs prior quarter”. In{' '}
                <i>Variance</i>, run the “4Q25 surprise” preset and click the Private Credit bar to drill. In{' '}
                <i>Forecast evolution</i>,{' '}
                <span className="linklike" onClick={() => onOpenEvolution({ mId: 'nr', bId: 'pc', targetQ: 11 })}>
                  watch Net Realizations · Private Credit converge on 4Q25 →
                </span>
              </p>
            </div>
            <div>
              <b>Planted stories</b>
              <p>
                Resolution Life mandate step-up (1Q25, known from Aug-24) · BCRED fee-perf dip (2Q24, missed by early
                vintages) · Cap Opps IV crystallization (4Q25 surprise) · DL IV &amp; Cap Opps V launches with catch-up
                fees · Energy Transition exit expected 3Q26 (forecast-only).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
