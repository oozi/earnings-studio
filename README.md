# BXCI Earnings Studio

An interactive OLAP-style explorer for BXCI earnings data — actuals and forecast
vintages over two hierarchical dimensions (P&L metric tree × business-line tree),
with pivoting, drill-down, variance waterfalls and forecast-evolution analysis.

**All data is synthetic** (seeded generator, nothing real).

**Re-implementing or borrowing from this UI?** Read [`UI-SPEC.md`](UI-SPEC.md) — a complete
functional specification of every view and interaction (cell-level rendering rules, hover/click
behavior, chart encodings, cross-view navigation payloads, formatting and favorability
conventions), written so the behavior can be rebuilt on a different stack and treated as
acceptance criteria.

## Run it

- **Zero-install:** double-click `dist/index.html` — the whole app is inlined
  into one file.
- **Dev server:** double-click `dev.cmd` (or `npm run dev` with Node on PATH),
  then open http://localhost:5173. A portable Node 22 lives in `.tools/node`,
  so nothing needs to be installed system-wide.
- `build.cmd` / `npm run build` — type-check + rebuild `dist/index.html`.
- `npm run sanity` — data-layer invariant checks (roll-up correctness, blend
  semantics, vintage coverage, forecast convergence) plus headline scale print.

## The views

| Tab | What it answers |
|---|---|
| **Overview** | Where are we? KPI cards, DE trajectory vs latest reforecast with dispersion band, fee-revenue treemap, QoQ bridge. |
| **Explore** | Slice & dice. Pivot with expandable metric/business tree rows, quarter or fiscal-year columns, any scenario layer (actuals, blend, single vintage), Δ-vs-vintage badges, %-of-parent mode, QoQ heat, CSV export. **Click any cell** to open the inspector: composition by the other dimension (bars/treemap), trend, top movers, and jumps into Variance / Evolution. |
| **Variance** | What changed and why. Any (quarter, scenario) A → B pair — QoQ, YoY, budget-vs-actual, vintage-vs-vintage — decomposed as a waterfall along either hierarchy. Click a bar to drill a level deeper; contribution table + fund-level movers alongside. |
| **Forecast evolution** | How did we see it coming? Fan chart of every vintage's path vs actuals, plus convergence on a chosen target quarter with error-by-horizon table. |

## Data model (a small OLAP cube)

```
fact value = cube[scenario layer][metric leaf][business leaf][quarter]
```

- **Quarters:** 1Q23–4Q27 (20). Actuals close through 1Q26.
- **Scenario layers:** Actuals + 11 forecast vintages (quarterly reforecast
  cycles Nov-23 … May-26; November cycles double as next-FY budgets). Each
  vintage covers its own quarter + 9 ahead. `NaN` = not covered.
- **Metric tree** (8 leaves, DE framework): DE → FRE (Fee Revenues: base fees,
  txn fees, fee perf revenues; Fee Expenses: comp, opex) + Net Realizations
  (realized perf revs, realized perf comp, principal investment income).
  Expenses are stored **signed (negative)** so every subtree total is a plain
  sum — roll-ups are exact by construction and waterfalls decompose additively.
- **Business tree** (29 fund leaves): Liquid Credit / Private Credit /
  Infrastructure & Asset Based Credit / Insurance Solutions → strategies → funds.
- **Engine** (`src/data/engine.ts`): every query sums the Cartesian product of
  the two nodes' descendant-leaf sets — at 8×29 leaves everything is instant in
  the browser, no server needed. The "blend" selector stitches actuals with the
  latest vintage.

## Synthetic data generator (`src/data/generate.ts`)

Deterministic (mulberry32, seed `20260702`). Each fund×metric has a smooth base
path (growth, launches, ramps, Q4 comp seasonality) plus noise → truth.
Forecast vintages re-compose the base path using only what was **known at that
vintage** (events carry knowledge schedules), distorted by per-vintage
level+slope errors that shrink with horizon; in-quarter estimates blend toward
truth. Planted stories to find:

- **Cap Opps IV crystallization, 4Q25** (+$95M realized perf rev) — unknown to
  forecasts before Aug-25; the "4Q25 surprise" variance preset.
- **Resolution Life mandate step-up, 1Q25** — appears in vintages from Aug-24.
- **BCRED fee-perf dip, 2Q24** — missed by earlier vintages.
- **DL IV (3Q24) and Cap Opps V (2Q25) launches** with catch-up fees; early
  budgets only partially reflect pipeline funds.
- **Energy Transition exit expected 3Q26** — lives only in recent forecasts.
- Management fees are systematically forecast a touch conservatively, so
  convergence charts drift upward toward actuals.

## Stack

Vite + React 18 + TypeScript, ECharts 5. No backend, no state library; the cube
is ~36k facts in typed arrays. `vite-plugin-singlefile` produces the
double-clickable `dist/index.html`. `scripts/screenshot.mjs` drives headless
Chrome (puppeteer-core) through every view for visual verification.
