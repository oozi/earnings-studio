import { useMemo, useState } from 'react';
import { Cube } from './data/engine';
import { generateDataset } from './data/generate';
import { LAST_ACTUAL, LATEST_VINTAGE, VINTAGES, qLabel } from './data/model';
import { OverviewView } from './components/OverviewView';
import { PivotView } from './components/PivotView';
import { VarianceView } from './components/VarianceView';
import { EvolutionView } from './components/EvolutionView';
import { VarianceCfg, EvoCfg } from './uiTypes';

type Tab = 'overview' | 'pivot' | 'variance' | 'evolution';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'pivot', label: 'Explore' },
  { id: 'variance', label: 'Variance' },
  { id: 'evolution', label: 'Forecast evolution' },
];

const initTab = (): Tab => {
  const h = window.location.hash.replace('#', '');
  return TABS.some((t) => t.id === h) ? (h as Tab) : 'overview';
};

export default function App() {
  const cube = useMemo(() => new Cube(generateDataset()), []);
  const [tab, setTabRaw] = useState<Tab>(initTab);
  const setTab = (t: Tab) => {
    setTabRaw(t);
    window.history.replaceState(null, '', `#${t}`);
  };
  const [varReq, setVarReq] = useState<{ cfg: VarianceCfg; id: number } | null>(null);
  const [evoReq, setEvoReq] = useState<{ cfg: EvoCfg; id: number } | null>(null);

  const openVariance = (cfg: VarianceCfg) => {
    setVarReq({ cfg, id: Date.now() });
    setTab('variance');
  };
  const openEvolution = (cfg: EvoCfg) => {
    setEvoReq({ cfg, id: Date.now() });
    setTab('evolution');
  };

  // Views stay mounted so pivot expansion, drill state etc. survive tab hops.
  const visible = (t: Tab) => ({ display: tab === t ? undefined : 'none' });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          BXCI&nbsp;<b>Earnings Studio</b>
          <span className="pill">SYNTHETIC DEMO DATA</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topmeta">
          Actuals through {qLabel(LAST_ACTUAL)} · Latest RF: {VINTAGES[LATEST_VINTAGE].short} · $M
        </div>
      </header>
      <main>
        <div style={visible('overview')}>
          <OverviewView cube={cube} onOpenVariance={openVariance} onOpenEvolution={openEvolution} goPivot={() => setTab('pivot')} />
        </div>
        <div style={visible('pivot')}>
          <PivotView cube={cube} onOpenVariance={openVariance} onOpenEvolution={openEvolution} />
        </div>
        <div style={visible('variance')}>
          <VarianceView cube={cube} request={varReq} />
        </div>
        <div style={visible('evolution')}>
          <EvolutionView cube={cube} request={evoReq} />
        </div>
      </main>
    </div>
  );
}
