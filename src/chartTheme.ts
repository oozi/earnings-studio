// Shared chart palette + reusable ECharts option builders.
import { HNode, topAncestor } from './data/model';
import { fmtM, fmtDelta } from './format';

export const ACCENT = '#0d6e4f';
export const INK = '#16232f';
export const UP = '#0d8a5e';
export const DOWN = '#c04438';
export const TOTAL = '#2b3a4e';

/** Segment colors for the business dimension (depth-1 ancestors). */
export const SEGMENT_COLORS: Record<string, string> = {
  liq: '#3f7ec2',
  pc: '#0f8a60',
  iabc: '#d98a1f',
  ins: '#7d5fc7',
  bxci: '#2b3a4e',
};

/** Top-level metric colors (FRE vs Net Realizations). */
export const METRIC_TOP_COLORS: Record<string, string> = {
  fre: '#2f6db3',
  nr: '#b07a2f',
  de: '#2b3a4e',
};

export function colorFor(node: HNode, dim: 'metric' | 'business'): string {
  const top = topAncestor(node);
  const map = dim === 'business' ? SEGMENT_COLORS : METRIC_TOP_COLORS;
  return map[top.id] ?? '#5b6873';
}

export function lerpColor(c1: string, c2: string, t: number): string {
  const p = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const a = p(c1), b = p(c2);
  return `#${a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Older vintages fade to slate; the newest is brand green. */
export const vintageColor = (i: number, n: number) => lerpColor('#c3cfda', '#0b6b4b', n <= 1 ? 1 : i / (n - 1));

export const compactNum = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;

export const truncate = (s: string, n = 15) => (s.length > n + 1 ? s.slice(0, n) + '…' : s);

export const AXIS_LABEL = { fontSize: 11, color: '#5b6873' };
export const SPLIT_LINE = { lineStyle: { color: '#eaeff4' } };

export const TOOLTIP_STYLE = {
  backgroundColor: '#ffffff',
  borderColor: '#dde4ea',
  textStyle: { color: INK, fontSize: 12 },
  extraCssText: 'box-shadow: 0 4px 16px rgba(16,24,40,.12); border-radius: 8px;',
};

// ------------------------------- Waterfall ---------------------------------

export interface WfArgs {
  startLabel: string;
  startValue: number;
  endLabel: string;
  endValue: number;
  steps: { name: string; delta: number; a?: number | null; b?: number | null }[];
  height?: number;
}

/**
 * Floating-bar waterfall: transparent base + visible segment, start/end
 * anchored at zero, dashed connectors drawn with a custom series.
 * Click events land on series 'wfmain'; dataIndex 0 = start,
 * 1..steps.length = steps, steps.length+1 = end.
 */
export function waterfallOption(w: WfArgs): any {
  const cats = [w.startLabel, ...w.steps.map((s) => s.name), w.endLabel];
  const lo: number[] = [];
  const seg: any[] = [];
  const levels: number[] = [];

  const pushBar = (base: number, size: number, color: string, labelText: string, labelUp: boolean) => {
    lo.push(base);
    seg.push({
      value: size,
      itemStyle: { color, borderRadius: 2 },
      label: {
        show: true,
        position: labelUp ? 'top' : 'bottom',
        formatter: () => labelText,
        fontSize: 10.5,
        color: '#3c4a58',
      },
    });
  };

  pushBar(Math.min(0, w.startValue), Math.abs(w.startValue), TOTAL, fmtM(w.startValue, 0), w.startValue >= 0);
  levels.push(w.startValue);
  let cum = w.startValue;
  for (const s of w.steps) {
    const before = cum;
    cum += s.delta;
    pushBar(Math.min(before, cum), Math.abs(s.delta), s.delta >= 0 ? UP : DOWN, fmtDelta(s.delta, 0), s.delta >= 0);
    levels.push(cum);
  }
  pushBar(Math.min(0, w.endValue), Math.abs(w.endValue), TOTAL, fmtM(w.endValue, 0), w.endValue >= 0);
  levels.push(w.endValue);

  const rotate = cats.length > 7 ? 26 : 0;

  return {
    animationDuration: 350,
    tooltip: {
      trigger: 'item',
      ...TOOLTIP_STYLE,
      formatter: (p: any) => {
        const i = p.dataIndex as number;
        if (i === 0) return `<b>${w.startLabel}</b>: ${fmtM(w.startValue)}`;
        if (i === cats.length - 1) return `<b>${w.endLabel}</b>: ${fmtM(w.endValue)}`;
        const s = w.steps[i - 1];
        const ab = s.a !== undefined && s.b !== undefined ? `<br/>${fmtM(s.a)} → ${fmtM(s.b)}` : '';
        return `<b>${s.name}</b>: ${fmtDelta(s.delta)}${ab}`;
      },
    },
    grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: cats,
      axisLabel: { ...AXIS_LABEL, interval: 0, rotate, formatter: (s: string) => truncate(s, 14) },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#cfd8e0' } },
    },
    yAxis: {
      type: 'value',
      splitLine: SPLIT_LINE,
      axisLabel: { ...AXIS_LABEL, formatter: compactNum },
    },
    series: [
      {
        name: 'wfbase', type: 'bar', stack: 'wf', silent: true, barWidth: '58%', barMaxWidth: 110,
        itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } },
        tooltip: { show: false }, data: lo,
      },
      { name: 'wfmain', type: 'bar', stack: 'wf', barWidth: '58%', barMaxWidth: 110, data: seg, cursor: 'pointer' },
      {
        name: 'wfconn', type: 'custom', silent: true, z: 5,
        data: levels.slice(0, -1).map((y, i) => [i, y]),
        renderItem: (_params: any, api: any) => {
          const i = api.value(0) as number;
          const y = api.value(1) as number;
          const p1 = api.coord([i, y]);
          const p2 = api.coord([i + 1, y]);
          const half = p2[0] - p1[0];
          return {
            type: 'line',
            shape: { x1: p1[0] + half * 0.29, y1: p1[1], x2: p2[0] - half * 0.29, y2: p2[1] },
            style: { stroke: '#9aa8b7', lineWidth: 1, lineDash: [3, 3] },
          };
        },
      },
    ],
  };
}

// -------------------------------- Treemap ----------------------------------

export function treemapOption(items: { name: string; value: number; color: string; pathLabel?: string }[]): any {
  return {
    tooltip: {
      ...TOOLTIP_STYLE,
      formatter: (p: any) =>
        `<b>${p.data?.pathLabel ?? p.name}</b><br/>${fmtM(p.value)} <span style="color:#64748b">$M</span>`,
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false as any,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        label: {
          show: true,
          formatter: (p: any) => `${p.name}\n${fmtM(p.value, 0)}`,
          fontSize: 11,
          lineHeight: 15,
        },
        itemStyle: { borderColor: '#fff', borderWidth: 1.5, gapWidth: 1.5 },
        data: items.map((it) => ({
          name: it.name,
          value: it.value,
          pathLabel: it.pathLabel,
          itemStyle: { color: it.color },
        })),
      },
    ],
  };
}
