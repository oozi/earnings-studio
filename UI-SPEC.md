# BXCI Earnings Studio — UI & interaction specification

This document describes **every piece of UI functionality in the app, precisely enough to
re-implement it on a different technology stack** without reverse-engineering the source. It is
written for a developer (or coding agent) who wants to use this app as a template for a real
earnings/OLAP explorer: read this for *what the UI does and why*; read the code for *how this
particular stack does it*. Behavior statements below (thresholds, orderings, guards, exact copy)
mirror the implementation, so they can be treated as acceptance criteria.

Source of truth per area:

| Area | File |
|---|---|
| App shell, tabs, cross-view wiring | `src/App.tsx` |
| Overview tab (KPIs, DE chart, treemap, bridge) | `src/components/OverviewView.tsx` |
| Explore tab (hierarchical pivot) | `src/components/PivotView.tsx` |
| Cell inspector drawer | `src/components/DrillDrawer.tsx` |
| Variance tab (A→B waterfall) | `src/components/VarianceView.tsx` |
| Forecast evolution tab (fan + convergence) | `src/components/EvolutionView.tsx` |
| Hierarchy dropdown picker | `src/components/TreeSelect.tsx` |
| Chart wrapper | `src/components/EChart.tsx` |
| Palette + waterfall/treemap chart builders | `src/chartTheme.ts` |
| Number formatting | `src/format.ts` |
| Dimensional model (trees, quarters, vintages) | `src/data/model.ts` |
| Query engine (aggregation, waterfall, movers, evolution) | `src/data/engine.ts` |
| Synthetic data + planted stories | `src/data/generate.ts` |
| All styling (design tokens, layout, components) | `src/styles.css` |

---

## 1. The model the UI operates on

Understanding four concepts makes every view below self-explanatory.

### 1.1 The cube

One fact store, queried live in the browser:

```
value = f(scenario layer, metric node, business node, quarter)
```

Facts exist only at **leaf × leaf** granularity (8 metric leaves × 29 fund leaves × 20 quarters
per layer). Any node-level number is the sum over the Cartesian product of the two nodes'
descendant leaves, computed on demand (no precomputed roll-ups — at this scale every query is
instant; a port with bigger dimensions would push the same query shape to a server/OLAP engine).

### 1.2 Time

20 quarters, **1Q23 – 4Q27**. "Today" in the demo is early July 2026, so the last closed actual
quarter is **1Q26** (`LAST_ACTUAL`). Quarter labels are compact `1Q26` everywhere; long form
`Q1 2026` is used in a few headings. Fiscal years = calendar years, `FY26`.

### 1.3 Scenario layers and coverage

The scenario dimension has 13 selectable values in three kinds:

- **Actuals** — covers quarters ≤ 1Q26 only.
- **11 forecast vintages** — quarterly reforecast cycles named by the month they were produced.
  Each vintage covers the quarter it was made in (an *in-quarter estimate*) **plus 9 more**
  (capped at 4Q27). November cycles double as the next fiscal year's **Budget**.

  | idx | short | label | made in | covers |
  |---|---|---|---|---|
  | 0 | Nov-23 | Nov-23 (FY24 Budget) | 4Q23 | 4Q23–1Q26 |
  | 1 | Feb-24 | Feb-24 reforecast | 1Q24 | 1Q24–2Q26 |
  | 2 | May-24 | May-24 reforecast | 2Q24 | 2Q24–3Q26 |
  | 3 | Aug-24 | Aug-24 reforecast | 3Q24 | 3Q24–4Q26 |
  | 4 | Nov-24 | Nov-24 (FY25 Budget) | 4Q24 | 4Q24–1Q27 |
  | 5 | Feb-25 | Feb-25 reforecast | 1Q25 | 1Q25–2Q27 |
  | 6 | May-25 | May-25 reforecast | 2Q25 | 2Q25–3Q27 |
  | 7 | Aug-25 | Aug-25 reforecast | 3Q25 | 3Q25–4Q27 |
  | 8 | Nov-25 | Nov-25 (FY26 Budget) | 4Q25 | 4Q25–4Q27 |
  | 9 | Feb-26 | Feb-26 reforecast | 1Q26 | 1Q26–4Q27 |
  | 10 | May-26 | May-26 reforecast | 2Q26 | 2Q26–4Q27 |

- **Blend** ("Actuals + May-26 RF") — actuals through 1Q26, then the latest vintage. Covers all
  20 quarters; this is the default scenario in the pivot and the "forecast continuation" used by
  Overview and the drawer trend.

**Coverage is a first-class UI concept.** A (scenario, quarter) pair outside the window has *no
value*: cells render an em-dash `—`, chart points are gaps, and the Variance view explains the
reason in words (§7.3). A quarter is **forecast-sourced** when: scenario = vintage (always, even
its in-quarter estimate), or blend with quarter > 1Q26; actuals are never forecast-sourced. This
drives all A/F badging and forecast cell styling (§3.4).

### 1.4 The two hierarchies

**Metric tree** — a Distributable Earnings P&L presentation, 15 nodes / 8 leaves. `[contra]`
marks expense/deduction lines; node ids in parentheses (cross-view payloads use them):

```
Distributable Earnings (de)
├─ Fee Related Earnings (fre)
│  ├─ Fee Related Revenues (frr)
│  │  ├─ Management Fees, net (mgmt)
│  │  │  ├─ Base Management Fees (base)
│  │  │  └─ Transaction & Advisory Fees, net (txn)
│  │  └─ Fee Related Performance Revenues (frpr)
│  └─ Fee Related Expenses (frx) [contra]
│     ├─ Fee Related Compensation (comp) [contra]
│     └─ Operating Expenses (opex) [contra]
└─ Net Realizations (nr)
   ├─ Realized Performance Revenues (rpr)
   ├─ Realized Performance Compensation (rpc) [contra]
   └─ Realized Principal Investment Income (pii)
```

**Business tree** — segment › strategy › fund, 40 nodes / 29 fund leaves:

```
BXCI (bxci)
├─ Liquid Credit Strategies (liq): CLO Platform (5 CLOs) · Loan & HY Funds (3) · Listed CEFs (2)
├─ Private Credit Strategies (pc): Direct Lending (BCRED, BXSL, DL III/IV, Euro DL II) ·
│                                  Opportunistic & Mezzanine (Cap Opps IV/V, Mezz III)
├─ Infrastructure & Asset Based Credit (iabc): Infra Credit (3) · Asset Based Finance (3)
└─ Insurance Solutions (ins): 5 SMAs (Corebridge, Everlake, F&G, Resolution Life, Other)
```

Every node knows its `short` display name and full breadcrumb `path`
(`BXCI › Private Credit › Direct Lending › BCRED`) — the path is surfaced as the hover tooltip
wherever a short name is shown.

### 1.5 Sign convention and favorability (load-bearing!)

Expense lines are stored **signed (negative)**. Consequences the whole UI relies on:

- Every roll-up is a plain sum — subtree totals and waterfalls are additively exact by
  construction. No "subtract expenses" special cases anywhere.
- Negative values render in **parentheses**, finance style: `(262.1)`.
- **A positive Δ always increases earnings**, whatever the line. Favorability coloring is
  therefore *purely the sign of the delta*: `+Δ` green, `(Δ)` red — including on expense lines
  (spending more than the comparison point shows a signed negative delta → red). Do **not**
  add a per-line "flip for expenses" rule on top of signed data; that double-counts the sign
  and turns overspends green. (Original version of this app had exactly that bug.)
- Contra lines get a typographic cue wherever named in trees/tables: *italic, muted gray*.

### 1.6 Number formatting (used identically everywhere)

Unit is **USD millions** app-wide (declared once in the top bar, and as `$M`/unit hints in
headers) — cells never repeat the unit.

| Kind | Rule | Examples |
|---|---|---|
| Value `fmtM` | 1 decimal (charts: 0), thousands separators, negatives in parentheses, missing → `—` | `498.5` · `(262.1)` · `—` |
| Delta `fmtDelta` | as above plus explicit `+` on positives | `+6.3` · `(3.8)` |
| Percent `fmtPct` | 1 decimal, signed by default, negatives in parentheses, non-finite → `—` | `+1.3%` · `(1.5%)` |
| % change `pctChange(a,b)` | `(b−a)/|a|`, but **null when |base| < $1M** — suppresses silly percentages off tiny bases; renders `—` | |

All numeric UI text uses **tabular (fixed-width) figures** so columns of numbers align.

---

## 2. App shell

- **Top bar** (52px, near-black green `#0f1d17`, sticky): brand ("BXCI **Earnings Studio**" with
  a small gradient-green square) + an amber-outlined pill `SYNTHETIC DEMO DATA`; centered tab
  nav; right-aligned context line: `Actuals through 1Q26 · Latest RF: May-26 · $M` — the one
  place that anchors *when now is* and the unit.
- **Tabs**: `Overview` · `Explore` · `Variance` · `Forecast evolution`. Active tab = white text
  + 3px bright-green underline (`#17a673`).
- **Routing**: the active tab is mirrored to the URL hash (`#overview`, `#pivot`, `#variance`,
  `#evolution`) via `history.replaceState` (no back-stack spam); on load the hash selects the
  initial tab. No other state is URL-persisted.
- **Views stay mounted** when switching tabs (hidden with `display:none`), deliberately: pivot
  expansion, drawer target, variance drill path, evolution target all survive tab hops. A port
  should preserve this — losing exploration state on tab switch is the #1 annoyance in tools
  like this.
- Content column max-width 1560px, centered, on a light gray `#eef1f5` canvas; content sits in
  white **panels** (12px radius, 1px `#e3e8ee` border, faint shadow). Base font: Segoe UI stack,
  13px. Below 1150px viewport width all multi-column grids collapse to one column.

Design tokens (CSS custom properties):

| Token | Value | Used for |
|---|---|---|
| `--ink` | `#16232f` | primary text, "Actual" chart lines |
| `--muted` / `--faint` | `#64748b` / `#7c8a98` | secondary text / labels |
| `--accent` | `#0d6e4f` | brand green: active controls, forecast lines |
| `--pos` / `--neg` | `#0d8a5e` / `#c04438` | favorable / unfavorable numbers & bars |
| `--fc-bg` / `--fc-ink` | `#f2f7fd` / `#35506b` | forecast-sourced cell background / text |
| segment colors | liq `#3f7ec2` · pc `#0f8a60` · iabc `#d98a1f` · ins `#7d5fc7` | business coloring |
| metric-family colors | fre `#2f6db3` · nr `#b07a2f` · de/totals `#2b3a4e` | metric coloring |

Categorical color rule: an item is colored by its **depth-1 ancestor** (segment for business
nodes, FRE/NR family for metric nodes), so fund-level charts stay readable with only 4–5 hues.

---

## 3. Shared UI vocabulary

Recurring pieces, specified once.

### 3.1 Toolbar controls

Every view opens with one or two toolbar rows inside the panel: each control is a tiny uppercase
gray label above the widget. Widgets: native `<select>`s, **segmented toggles** (joined buttons,
active = solid accent green with white text), small **preset buttons** (outlined, one row), and
a checkbox with label. Toolbars wrap and are bottom-aligned.

### 3.2 TreeSelect (hierarchy picker)

A dropdown over a hierarchy, used for *scope* selection everywhere (never multi-select — a
selection is a single node, and aggregation over its subtree is implied):

- Closed: a button showing the current node's **short name in bold** + `▾`; hover tooltip =
  full path. Label above states the node's current **role**, which changes with view settings —
  e.g. `Metric (rows from)` vs `Metric (slice)` in the pivot (§5.2).
- Open (click): a popover (min 320px, max-height 360px, scrollable) rendering the tree with
  carets `▸/▾` per non-leaf, 14px indent per level. It opens pre-expanded to show root, the
  current selection's ancestor chain, and the selection's own children; other branches stay
  collapsed. Carets toggle branches without selecting.
- Click a **name** to select that node (any node, internal or leaf) and close. Esc or
  click-outside closes without change. Current selection row is tinted green; contra metric
  names render italic/muted.

### 3.3 Actual/Forecast marking

- Column-header badges in the pivot: tiny `A` (green tint) / `F` (blue tint) chips.
- Forecast-sourced **table cells**: light blue background, *italic*, dark-slate-blue text — a
  cell-level treatment so mixed actual/forecast rows read at a glance.
- The drawer states it in words: `ACTUAL` / `FORECAST` badge next to the headline value.
- Charts: actuals are solid strokes/fills; forecasts are **dashed strokes / translucent
  dash-bordered bars** in the same hue.

### 3.4 Callouts

- **Insight strip**: auto-generated one-sentence takeaway; light green panel with a 3px accent
  left border. Used in Variance (§7.4) and Evolution (§8.3). Data-derived, no LLM.
- **Warning strip**: amber panel used for coverage problems, always *explaining the reason*,
  not just "no data" (§7.3).

### 3.5 Inline bar lists (HTML, not chart library)

Two list-of-bars idioms used in the drawer and variance views — plain DOM elements, cheap and
crisp at small sizes:

- **Composition bars** (`name | bar | value | share%`): bar length ∝ |value| / max(|values|),
  left-anchored; fill = the node's categorical color, or red if the value is negative. Share
  column = value / parent total (0 dp), suppressed when |parent total| < $1M.
- **Diverging mover bars** (`name | bar | Δ`): track with a center zero line; bar grows right
  from center for +Δ (green) or left for −Δ (red), length ∝ |Δ| / max|Δ| (half-track = max).
  Value column is a colored `fmtDelta`. Rows carry full-path tooltips.

### 3.6 Chart wrapper & shared cosmetics

One thin wrapper owns every chart: init once per mount, full option replace on data change
(`notMerge`), auto-resize via `ResizeObserver`, and an event map (`click`, …) that re-binds when
handlers change. Port equivalent: any charting lib with imperative option + resize + event APIs.

Shared cosmetics: white tooltip card (1px `#dde4ea` border, 8px radius, soft shadow, 12px ink
text); axis labels 11px `#5b6873`; horizontal gridlines only (`#eaeff4`); no axis ticks; light
category axis line `#cfd8e0`; entry animation 250–350ms; charts never scroll — they fit their
panel width.

### 3.7 Waterfall chart builder (used by Overview + Variance)

Input: start label/value, end label/value, ordered steps `{name, delta, a, b}`.

- Categories: `[start, …steps, end]`. Start/end bars anchored at zero, slate `#2b3a4e`; step
  bars **float** between cumulative levels (implementation: invisible-base stacked bars),
  green `#0d8a5e` for +Δ, red `#c04438` for −Δ.
- Every bar is labeled: totals as `fmtM` 0 dp, steps as signed `fmtDelta` 0 dp; label sits above
  rising bars / below falling ones (10.5px, dark gray).
- Dashed gray **connector** from each bar's ending level to the next bar (drawn as a custom
  overlay spanning the inter-bar gap).
- Category labels truncate at 14 chars + `…`; if more than 7 categories, rotate 26°. Y-axis
  labels compact thousands (`1.2k`).
- Tooltip (per item): totals → `**label**: value`; steps → `**name**: +Δ` plus a second line
  `a → b` showing the step's absolute A and B values.
- **Click a step bar to drill** (Variance only, §7.5): dataIndex 1…n maps to steps; start/end
  clicks are inert. Cursor: pointer.

### 3.8 Treemap builder (Overview + drawer)

Flat one-level treemap of **positive-value leaves only** (zero/negative items are omitted; the
drawer prints `N zero/negative item(s) not shown in treemap` when any were). Tile color =
categorical color of the leaf's family (§2); 1.5px white gaps; label inside = short name +
`fmtM` 0 dp value; tooltip = full path + value; no zoom/roam/breadcrumb (fixed, calm).

---

## 4. Overview tab

Purpose: land the user with orientation ("where are we, what moved, where do I dig next").
Layout: a 4-up KPI row; below it a 2-column grid: full-width DE chart, then treemap + bridge
side by side, then a full-width notes panel.

### 4.1 KPI cards (×4)

For **Distributable Earnings, Fee Related Earnings, Fee Related Revenues, Net Realizations**,
all at BXCI total, latest actual quarter (1Q26). Card anatomy, top to bottom:

1. Uppercase small gray metric name.
2. Value: `fmtM` at 23px bold + small `$M` unit.
3. Two stat pills: `QoQ +5.4%` and `YoY +12.1%` (`fmtPct` of `pctChange` vs q−1 / q−4).
   Pill = green tint for ≥ 0, red tint for negative.
4. **Sparkline** (inline SVG, 150×38): solid near-black polyline = the full actuals series;
   dashed green polyline = the blend forecast from 1Q26 onward (starts at the last actual point
   so the two lines connect). Both share one min/max scale; nulls become gaps. No axes.
5. Footer caption: `Q1 2026 actual · dashed = latest RF`.

### 4.2 "Distributable Earnings — actuals and latest reforecast" (full-width, 300px)

Sub-caption explains the encoding in words (solid vs hollow vs band). Content:

- **Bars**: DE per quarter from the blend — actuals as solid dark green with rounded tops;
  forecast quarters as "hollow" bars: 30%-alpha fill + dashed green border.
- **RF dispersion band**: for each forecast quarter, min/max of DE across the **last four
  vintages** that cover it (needs ≥ 2 values). Rendered as a translucent green area behind the
  bars — an honest "how much do recent cycles disagree" cue, cheaper than a real fan here.
- **FRE line**: solid dark-blue line with small point markers (actuals) continuing as a dashed
  line (blend forecast) from 1Q26.
- Legend: the three real series (`Distributable Earnings`, `Fee Related Earnings`,
  `RF dispersion (last 4 vintages)`); helper series (band plumbing, FRE forecast continuation)
  are excluded from both legend and tooltip.
- Axis-hover tooltip: quarter header + only DE / FRE / "FRE (forecast)" rows with bold values.

### 4.3 "Where fee revenues come from — 1Q26 actual" (treemap, 300px)

Fee Related Revenues by **fund** (all 29 leaves, positives only), tiles colored by segment
(§3.8). Sub-caption carries an inline link **`Open the Explorer →`** → switches to the Explore
tab as-is. Tooltips give the full fund path — this chart doubles as a "learn the portfolio" map.

### 4.4 "DE bridge: 4Q25 → 1Q26 by segment" (waterfall, 300px)

The §3.7 waterfall of DE, actual 4Q25 → actual 1Q26, decomposed by the four segments, steps
sorted descending Δ. Sub-caption states the headline story in words and links
**`Open in Variance →`** → opens Variance pre-configured to exactly this comparison (§9), where
the same waterfall is interactive/drillable.

### 4.5 "About this demo" (notes panel)

Three text columns: **Data** (what's synthetic, scale), **Try this** (a guided tour: click a
pivot number → "Bridge vs prior quarter"; run the "4Q25 surprise" preset and click the Private
Credit bar; plus an inline deep link `watch Net Realizations · Private Credit converge on
4Q25 →` that jumps to Evolution pre-targeted), **Planted stories** (the list in §11). This
panel is demo furniture — a real deployment replaces it — but the *pattern* of embedded guided
links that pre-configure analytical views is worth keeping.

---

## 5. Explore tab (hierarchical pivot)

The workhorse: tree rows × period columns, any scenario, with comparison, normalization, heat,
export, and click-to-inspect. One panel: two toolbar rows, the table, a footnote line.

### 5.1 State & defaults

| State | Default | Notes |
|---|---|---|
| Row dimension | Metric tree | segmented toggle `Metric tree` / `Business tree` |
| Metric scope | DE (root) | TreeSelect |
| Business scope | BXCI (root) | TreeSelect |
| Expanded rows | metric: de, fre, frr · business: bxci | **kept per dimension**, so flipping row dim and back restores each tree's expansion |
| Period range | 1Q25 → 4Q26 | From/To selects |
| Column mode | Quarters | `Quarters` / `Fiscal years` |
| Scenario | Blend | see below |
| Compare to | — (off) | Δ vs a chosen vintage |
| Display | $M | `$M` / `% of parent` |
| Δ heat | off | checkbox |

### 5.2 Toolbar, control by control

- **Rows** toggle chooses which hierarchy provides rows. The two TreeSelects are always both
  present with **role-swapping labels**: the row hierarchy's picker reads `… (rows from)` (its
  node = the root row of the table); the other reads `… (slice)` (its node filters everything —
  e.g. rows = P&L lines, slice = Insurance Solutions only).
- **Scenario** select: `Actuals + May-26 RF` (blend) · `Actuals only` · optgroup "Single
  forecast vintage" listing all 11 full vintage labels.
- **Compare to** select: `—` or `Δ vs <vintage label>` for any vintage → adds in-cell deltas
  (§5.4). Comparing e.g. blend vs the FY26 Budget vintage is *the* budget-tracking view.
- **Columns**: `Quarters` / `Fiscal years`; **From**/**To** quarter selects (choosing From >
  To clamps the other side so From ≤ To always).
- **Presets**: `FY24–25`, `1Q25–4Q26`, `FY26–27`, `All` — set the range in one click.
- **Show**: `$M` / `% of parent` (§5.4). `% of parent` disables compare-deltas, heat and the Σ
  column (they only make sense in $M).
- **Δ heat** checkbox (§5.4).
- **⭳ CSV** button, right-aligned (§5.6).

### 5.3 Table structure

- **Sticky everywhere**: header row sticks to the top, the row-name column sticks left (the
  corner cell stacks above both); the table body scrolls both ways inside the panel with a
  viewport-capped height (`100vh − 320px`).
- Header: row-name column header shows the row dimension name (`P&L line` / `Business line`)
  with the current unit as a sub-note (`$M` / `% of parent`); each period column header =
  label + A/F badge. FY labels get an **`E` suffix** (`FY26E`) when any component quarter is
  forecast-sourced; under a single-vintage scenario every column is `F` (a vintage's in-quarter
  estimate is still a forecast). Last column: `Σ range`.
- Rows = the row-scope node's subtree, pre-order, indented 16px/level with `▸/▾` carets on
  parents (empty spacer at leaves). Clicking the caret **or the name** toggles expansion.
  Weights: scope row 700, other parents 600, leaves 400; contra names italic gray; hover
  tooltip = full path. The scope row itself gets a light blue-gray tint across the row.
- Row hover tints the whole row; forecast cells use a slightly bluer hover so the A/F
  distinction survives hovering.

### 5.4 Cell rendering ($M mode)

For row node r and column c (a quarter, or an FY = 4 quarters):

- **Value** = sum over the column's quarters of the (scenario, r, slice) aggregates. FY columns
  are **strict**: if any component quarter is uncovered, the FY cell is `—` (never a misleading
  partial-year sum). A missing single quarter is `—` too.
- Forecast-sourced cells get the §3.3 treatment (blue tint, italic). For FY columns the whole
  cell counts as forecast if *any* component quarter is.
- **In-cell compare delta** (when Compare-to is on): a second, smaller line under the value:
  `fmtDelta(value − vintage value, 0 dp)`, green/red by sign (§1.5); a centered `·` when either
  side is uncovered (e.g. quarters before the vintage's window). Comparing a scenario to
  itself yields `+0`s — harmless.
- **Δ heat** (when on): background tint by percent change vs the **previous period** — for
  quarter columns q−1, for FY columns the same FY one year earlier (strict coverage again).
  Alpha ramps linearly with |Δ%|, saturating at ±15% → max alpha 0.22; green for +, red for −.
  Base-too-small/missing (§1.6) → no tint. Deliberately background-only: values stay readable,
  and the eye scans for "hot" quarters (e.g. the 4Q25 crystallization row lights up).
- **Σ range** column: sum of the row's non-null cells across the visible range (`—` if none) —
  a quick "total over what I'm looking at".
- **Every quarter cell is drillable** (§6): pointer cursor, `Click to inspect` tooltip, and on
  hover a thin inset accent outline. FY cells are *not* drillable (no single quarter to
  inspect). Clicking an uncovered (`—`) quarter cell still opens the drawer, which then shows
  em-dashes — harmless by design.
- Footnote under the table (exact copy): *"USD millions; expenses shown as negatives in
  parentheses. Shaded italic cells are forecast-sourced. Click any quarter cell to inspect its
  composition, drivers and trend."*

### 5.5 `% of parent` mode

Each cell = row value ÷ **immediate-parent's** value for the same column (within the current
slice); the scope row reads `100%`. Unsigned percent, 1 dp; parentheses when the ratio is
negative (e.g. Fee Related Expenses as a share of FRE → `(112.9%)`). Guard: `—` when the parent
is missing or |parent| < $1M. Compare-deltas, heat and Σ are suppressed in this mode.

### 5.6 CSV export

Downloads the **visible table** (current expansion, columns, scenario), always in $M:
header `Line, <col labels…>, Sum`; row names prefixed with 2 spaces per depth level (indentation
survives), quoted with `""` escaping; raw values `toFixed(2)` (no parentheses/thousands
formatting — spreadsheet-native), empty string for `—`; CRLF line endings. Filename encodes
context: `bxci_pivot_<metric|business>_<blend|actual|vN>.csv`.

---

## 6. The cell inspector ("drill drawer")

The signature interaction: **any number can explain itself**. Clicking a pivot quarter cell
slides in a right-hand drawer (480px, max 92vw, below the top bar, 160ms slide-in). There is
**no backdrop** — the page behind stays live, so clicking other cells re-targets the drawer in
place (fast cell-to-cell comparison). Close: `✕` or Esc. The drawer's internal navigation state
resets whenever a new cell is clicked.

Context: `{metric node, business node, quarter, scenario, breakdown dim}` — the breakdown dim
starts as the **opposite** of the pivot's row dimension (you were looking at P&L rows, so the
drawer first answers "which businesses make up this number").

### 6.1 Header

- Headline value (`fmtM`, 24px bold) + `$M` + **`ACTUAL`/`FORECAST`** badge (§1.3).
- Sub-line: `Q4 2025 · Actuals + May-26 RF` (long quarter + scenario label).
- Two **scope chips**: `METRIC FRE` and `BUSINESS BXCI` (short names, full-path tooltips), each
  with a small **`↑` button** (tooltip `Up to <parent>`) that re-scopes to the parent — the
  inverse of drilling down, hidden at the roots.

### 6.2 "Where does it come from?" (composition)

Header row holds two mini segmented toggles: **`By business` / `By metric`** (flips breakdown
dim) and **`Bars` / `Treemap`** (representation).

- **Bars** (default): §3.5 composition bars over the breakdown node's **children**, sorted by
  |value| descending, with share-of-total column. Rows for nodes that have children are
  clickable (hover tint, tooltip `Drill into <name>`) → **descend**: the breakdown scope
  becomes that node and the whole drawer (headline included) re-computes. Leaf rows are inert
  (tooltip = path).
- **Treemap**: §3.8 over the scope's **descendant leaves** (not children) — the "map view" of
  the same number.
- At a leaf along the breakdown dim: *"At leaf level along this dimension — no further
  breakdown."*

### 6.3 Trend (160px chart)

Full 20-quarter line chart for the current (metric × business): solid ink **Actual** line +
dashed green forecast overlay — the selected vintage's full path when the scenario is a vintage
(series named with the vintage label), otherwise the blend continuation from 1Q26. A dashed
amber-brown vertical marker pins the inspected quarter. Axis-hover tooltip with values.

### 6.4 Top movers vs previous quarter

§3.5 diverging bars: top 6 **leaf-level** movers (|Δ| desc) along the breakdown dim within the
current scope, comparing q−1 → q under the *same scenario*. Heading names the quarter
(`Top movers vs 3Q25`). Hidden entirely when q−1 isn't covered by the scenario. This answers
"who moved it" one level deeper than the composition bars.

### 6.5 Actions (cross-view jumps, §9)

- **`Bridge vs 3Q25 →`** (hidden at q = 1Q23): opens Variance as A = (scenario, q−1) →
  B = (scenario, q), decomposed by the drawer's current breakdown dim, scoped to the drawer's
  metric × business.
- **`Forecast evolution →`**: opens Evolution targeted at this metric × business × quarter.

---

## 7. Variance tab (A→B bridge)

Purpose: *what changed and why*, for **any** pair of (quarter, scenario) points — QoQ, YoY,
budget-vs-actual, vintage-vs-vintage re-forecast drift — decomposed along either hierarchy,
with recursive drill.

### 7.1 Configuration toolbar

- **Compare (A → B)**: two side editors, each = colored tag (`A` blue, `B` green) + quarter
  select + scenario select (`Actual` / `Actuals+RF` / optgroup of vintages). Defaults:
  A = 4Q25 Actual, B = 1Q26 Actual.
- **Decompose by**: `Business line` (default) / `Metric`.
- Metric & business TreeSelects with role-swapping labels: the decompose dimension's picker is
  the **drill scope** (waterfall = its children), the other is the **slice** held fixed.
- **Presets** (one click each, chosen to teach the tool — a port should derive equivalents from
  its own calendar/vintage metadata rather than hardcoding):
  - `QoQ 1Q26 vs 4Q25` — last two actual quarters.
  - `YoY 1Q26 vs 1Q25` — actuals a year apart.
  - `1Q26: Budget → Actual` — A = Nov-25 vintage (= FY26 Budget) at 1Q26, B = actual.
  - `4Q25 surprise: Aug-25 RF → Actual` — the planted crystallization miss.
  - `4Q26 outlook: Feb-26 → May-26 RF` — two vintages' views of the same future quarter
    (re-forecast drift; no actual involved).

### 7.2 Side labels

Everywhere a side is named (chart ends, table headers, insight), the compact form is
`<quarter> <source>`: `1Q26 A` (actual), `1Q26 Nov-25` (vintage), and for blend `A`/`F` by
whether the quarter is past the actual boundary (`3Q26 F`).

### 7.3 Coverage guard

If either side's (scenario, quarter) is uncovered, the chart/table area is replaced by an amber
warning strip that **explains the window**, one line per bad side:
`Side A (4Q27 A) has no data — actuals end at 1Q26.` /
`Side B (2Q25 May-24) has no data — May-24 covers 2Q24–3Q26.` (Blend always covers.)

### 7.4 Drill path + insight

- **Breadcrumbs** of the decompose-side scope (`METRIC DRILL PATH  DE › FRE`): every ancestor
  is a clickable link jumping back up; the current node is bold/inert; suffix hint
  *"click a bar to drill in"*. Breadcrumbs and the TreeSelect are two views of the same state.
- **Insight strip** (§3.4), auto-generated:
  `**FRE · BXCI**: increased **+2.6** (+1.1%) from 1Q26 Nov-25 to 1Q26 A. Largest driver:
  **Fee Revenues** (+6.3).` — direction word from the sign of net Δ, percent via `pctChange`
  (suppressed on tiny bases), largest driver by |Δ|.

### 7.5 The waterfall (360px)

§3.7 chart of scope A-total → children steps → B-total. Step order: **business decomposition
sorts by Δ descending** (biggest positive first — reads as a ranked story); **metric
decomposition keeps natural P&L order** (revenues before expenses, as a finance reader
expects). **Clicking a step bar descends** into that child (updates scope, breadcrumbs, table,
movers); leaf steps ignore clicks.

### 7.6 Contribution detail table

One row per waterfall step, same order. Columns:

| Column | Content |
|---|---|
| name | short name; blue link → descend (non-leaf only; leaves plain with path tooltip) |
| `<A label>` / `<B label>` | absolute values both sides (`fmtM`) |
| Δ | `fmtDelta`, green/red **by sign** (§1.5) |
| Δ% | `pctChange(a,b)`, `—` on tiny/missing base |
| share of net Δ | step Δ ÷ net Δ, 0 dp, unsigned; `—` when |net| ≤ $0.5M. **Can exceed ±100%** when steps offset (e.g. `246%` / `(146%)`) — legitimate, not a bug |

### 7.7 Top fund / leaf movers

Beside the table: §3.5 diverging bars of the top **10 descendant leaves** of the scope along
the decompose dim (|Δ| desc, other dimension held at its slice) — skipping intermediate levels
to answer "which *funds* (or which *P&L leaves*) actually moved it".

---

## 8. Forecast evolution tab

Purpose: *how did our forecasts see it coming* — forecast accuracy and revision behavior made
visible. Defaults: FRE × BXCI, target 4Q25 (the planted-surprise quarter). Controls: metric +
business TreeSelects, and a **target quarter** select whose options append ` (actual known)`
for quarters ≤ 1Q26.

Layout: 3:2 grid — fan chart left, convergence panel right.

### 8.1 Fan chart — "Every vintage's view of FRE · BXCI" (390px)

- X = all 20 quarters; Y auto-scales (not zero-anchored — revisions matter more than absolute
  zero here).
- **One line per vintage** (11), no point markers, spanning exactly its coverage window. Color
  encodes **age**: linear ramp from pale slate `#c3cfda` (oldest) to brand green `#0b6b4b`
  (newest); the newest line is drawn thicker (2.6px vs 1.3px). The ramp *is* the legend's
  logic — sub-caption says "older = lighter".
- **Actuals**: bold near-black line with point markers, drawn on top.
- Two vertical reference lines: **target quarter** (solid amber, labeled `target 4Q25`) and
  **last actual** (dashed gray, labeled `last actual`).
- Hovering a line highlights it and dims the rest (focus emphasis). Axis-hover tooltip lists
  every series' value at that quarter. Scrollable one-row legend on top (12 entries); legend
  clicks toggle series (charting-lib default, kept).
- **Click any data point — or an x-axis label — to re-target** the convergence panel to that
  quarter (the amber marker jumps; select, chart, insight and table all follow).

### 8.2 Convergence panel — "Convergence on Q4 2025" (210px chart)

- X = only the vintages that cover the target (in age order); labels rotate 30° when > 7.
  Y = that vintage's forecast for the target (accent-green line, prominent point markers).
- When the target has an actual: dashed ink horizontal line labeled `Actual 305.9`.
- Sub-caption switches: "What each successive forecast cycle said 4Q25 would be — versus where
  it actually landed." / "… (actual not yet available)."

### 8.3 Insight + error table

- Insight strip (only when the actual is known), signed % errors vs actual:
  `Nov-23 (8q out) was off by +12.3% · 1 quarter out: (2.1%) · in-quarter estimate: +0.4%`
  (first covering vintage, horizon-1, horizon-0 — skipping any that don't exist).
- Table, one row per covering vintage: full vintage label · **horizon** (`8q` = target −
  made-in) · forecast (`fmtM`) · **Δ vs actual** (`fmtDelta`, sign-colored: green = the vintage
  came in *above* the eventual actual, red = below — direction of miss, not favorability) ·
  **% err** (Δ ÷ |actual|, suppressed when |actual| ≤ $1M). When the actual is known, a final
  emphasized row `Actual — <value>` closes the table.

---

## 9. Cross-view navigation map

The views form a loop: *see it (Overview) → slice it (Explore) → explain it (Variance) →
question the forecast (Evolution)*. Jumps carry a **typed payload of node ids + points** and
switch tabs; the receiving view applies the payload to its own state (which otherwise
persists). Payloads are wrapped with a nonce so re-sending the *same* target still re-applies.

| From | Trigger | Opens | Payload |
|---|---|---|---|
| Overview §4.3 | `Open the Explorer →` | Explore | none (as-is) |
| Overview §4.4 | `Open in Variance →` | Variance | dim=business, DE × BXCI, A=4Q25 A, B=1Q26 A |
| Overview §4.5 | `watch NR · Private Credit converge …` | Evolution | nr × pc, target 4Q25 |
| Pivot cell | click | Drawer (in-place) | m, b, q, scenario, dim = anti(row dim) |
| Drawer §6.5 | `Bridge vs <q−1> →` | Variance | drawer's dim/m/b; A=(sel,q−1), B=(sel,q) |
| Drawer §6.5 | `Forecast evolution →` | Evolution | drawer's m × b, target = q |
| Anywhere | tab click | that view | state as last left (views stay mounted) |

---

## 10. Porting notes (stack-portability)

- **Cleanly portable** (pure logic, keep as-is): the cube/query engine (§1.1), coverage rules
  (§1.3), signed-values + sign-favorability (§1.5), formatting (§1.6), waterfall step math,
  leaf-movers ranking, evolution/horizon math, all state machines described above.
- **Charting-library-specific** (needs an equivalent, not a copy): floating-bar waterfall via
  invisible stacked base + custom connector overlay; treemap; line-series "focus" emphasis;
  vertical/horizontal reference lines with labels; axis-label click events. Any of ECharts /
  Highcharts / AG Charts / d3 can do these; the drawer's composition/mover bars are plain DOM
  on purpose (crisper + cheaper than charts at that size) — keep that split.
- **CSS specifics**: sticky header + sticky first column on one table (watch z-index at the
  corner); `font-variant-numeric: tabular-nums`; the drawer is `position:fixed` with **no
  backdrop** (deliberate, §6).
- **Scale envelope**: 8 × 29 leaves × 20 quarters × 12 layers ≈ 28k populated facts, summed on
  demand; the biggest render is ~40 rows × 21 columns. No virtualization, memoized derivations
  per view only. A port with hundreds of leaves needs server-side aggregation and row
  virtualization, but the *interaction contract* above doesn't change.
- **Known gaps** (candidate improvements, honest as-built): no keyboard navigation/ARIA in
  TreeSelect, table or drawer (mouse + Esc only); favorability and A/F rely partly on color
  (italics/badges mitigate); no deep-linking beyond the tab hash; no swap-A/B button in
  Variance; treemap drops negative items (noted in-UI); pivot heat has no legend; the demo's
  preset buttons hardcode this dataset's calendar (§7.1).

## 11. Appendix: the synthetic dataset (why the demo tells stories)

Deterministic seeded generator (`generateDataset(seed = 20260702)`): per fund × metric smooth
base paths (growth, launches with catch-up fees, ramps, Q4 comp seasonality) + noise → truth;
actuals = truth ≤ 1Q26. Each vintage re-composes base paths using **only events known at that
vintage** (events carry per-vintage knowledge schedules), then applies level+slope errors that
shrink as horizon → 0; in-quarter estimates blend 65% toward truth. Planted stories the UI
copy references: Cap Opps IV crystallization 4Q25 (+$95M rpr; unknown before Aug-25 — the
"4Q25 surprise" preset), Resolution Life mandate step-up from 1Q25 (known from Aug-24), BCRED
fee-perf dip 2Q24 (missed by early vintages), DL IV / Cap Opps V launches with catch-up fees,
Energy Transition exit 3Q26 (forecast-only), and a mild systematic conservative bias in
management-fee forecasts (visible as upward drift in convergence charts). A port pointed at
real data deletes this file — but keep the *idea* of seeded demo stories for onboarding and
screenshots.
