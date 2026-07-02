// Number formatting, finance style: USD millions, one decimal, negatives in
// parentheses, em-dash for missing.

export function fmtM(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v < 0 ? `(${abs})` : abs;
}

/** Signed delta: +45.2 / (45.2). */
export function fmtDelta(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v < 0 ? `(${abs})` : `+${abs}`;
}

export function fmtPct(p: number | null | undefined, dp = 1, signed = true): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  const abs = Math.abs(p * 100).toFixed(dp);
  if (p < 0) return `(${abs}%)`;
  return signed ? `+${abs}%` : `${abs}%`;
}

/** Percent change b vs a; null when the base is too small to be meaningful. */
export function pctChange(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  if (Math.abs(a) < 1) return null;
  return (b - a) / Math.abs(a);
}
