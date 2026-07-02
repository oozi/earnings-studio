import { SidePoint } from './data/engine';

/** Cross-view navigation payloads (nodes referenced by id). */
export interface VarianceCfg {
  dim: 'metric' | 'business';
  mId: string;
  bId: string;
  A: SidePoint;
  B: SidePoint;
}

export interface EvoCfg {
  mId: string;
  bId: string;
  targetQ: number;
}
