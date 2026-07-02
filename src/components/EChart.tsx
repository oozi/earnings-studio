import { CSSProperties, useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface Props {
  option: any;
  height?: number | string;
  style?: CSSProperties;
  onEvents?: Record<string, (params: any) => void>;
}

/** Thin ECharts wrapper: init once, setOption on change, resize via observer. */
export function EChart({ option, height, style, onEvents }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const chart = echarts.init(ref.current!);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current!);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    const entries = Object.entries(onEvents);
    for (const [evt, handler] of entries) chart.on(evt, handler);
    return () => {
      for (const [evt, handler] of entries) chart.off(evt, handler);
    };
  }, [onEvents]);

  return <div ref={ref} style={{ width: '100%', height: height ?? 300, ...style }} />;
}
