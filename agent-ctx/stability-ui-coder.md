# Task: stability-ui

**Agent**: Z.ai Code (fullstack coder)
**File edited**: `/home/z/my-project/src/app/page.tsx`
**Result**: ✅ Home route returns HTTP 200, `bun run lint` clean

## Context used from previous agents
- Read `/agent-ctx/watchlist-telegram-ui.md` — confirmed `ScreenPanel`
  signature/props pattern and that `stabilityData={stabilityData}` was already
  being passed by the parent (line ~1393) but not yet consumed by ScreenPanel.

## What was done

### 1. ScreenPanel signature (line ~2508)
Extended the destructured props + inline type to add `stabilityData`
(typed `Record<string, any> | undefined`). The parent Home component was
already passing `stabilityData={stabilityData}`, so it is now consumed.

### 2. New hooks at the top of ScreenPanel (lines ~2509-2544)
Added BEFORE the early returns (correct React hooks ordering):
- `const [sortBy, setSortBy] = useState<"signal" | "smoothed">("signal")`
- `const top10 = screen?.top10 ?? []` — captured once so both memos share the
  same dependency reference (fixes a `react-hooks/preserve-manual-memoization`
  lint error that occurred when using `screen?.top10` in the dep array but
  `screen.top10` inside the memo body).
- `sortedTop10` useMemo — when `sortBy === "smoothed"`, returns a NEW array
  sorted by `stabilityData[symbol].smoothedScore` DESC (falls back to raw
  `signalScore` when stabilityData has no entry). When `sortBy === "signal"`,
  returns the original `top10` reference unchanged.
- `stabilityCounts` useMemo — iterates `top10` and tallies
  `{ stable, volatile, erratic, newEntries, noConsensus }`. Stocks missing
  from `stabilityData` count as both `newEntries` and `noConsensus`.

### 3. StabilityBadge helper component (lines ~1658-1671)
Defined right after `SignalScoreBadge`, before `VolMultBadge`. Renders a
colored pill + optional "SM: NN" subtext:
- `STABLE` → `bg-emerald-100 text-emerald-700` (+ dark variants)
- `VOLATILE` → `bg-amber-100 text-amber-700`
- `ERRATIC` → `bg-red-100 text-red-700`
- `NEW` (default) → `bg-blue-100 text-blue-700`

### 4. Sort toggle near table title (lines ~2770-2793)
Wrapped `CardTitle` in a flex-row div. In momentum mode (when `top10.length > 0`)
renders a `Sort: Signal | Smoothed` toggle — two `<button>` elements. The active
one gets `bg-primary text-primary-foreground`; inactive gets muted + hover. The
whole toggle is hidden in bridge mode (stability data is momentum-specific).

### 5. Summary banner above the table (lines ~2802-2814)
Inserted at the top of `CardContent`, before the empty-state check. Only shows
in momentum mode when `top10.length > 0`. Renders the exact text format:
`"X stable · Y volatile · Z erratic · W new entries | N stocks need 2+ appearances for consensus"`
with color-coded bold counts (emerald/amber/red/blue/amber).

### 6. New column headers — momentum mode only (lines ~2862-2864)
Added two headers between the existing `Signal` and `Trend` headers:
- `<TableHead className="text-right hidden md:table-cell">Smooth</TableHead>`
- `<TableHead className="text-center hidden lg:table-cell">Stability</TableHead>`
Column order is now: … Setup · Signal · Smooth · Stability · Trend · Stop · R:R · Vol

### 7. New table cells — momentum mode only (lines ~2929-2934)
Added two cells between the existing Signal cell and Trend (Sparkline) cell:
- **Smooth cell** (`text-right hidden md:table-cell`): renders
  `<SignalScoreBadge score={stabilityData?.[s.symbol]?.smoothedScore ?? s.signalScore} />`
  — reuses the existing SignalScoreBadge so coloring matches (>=80 green,
  >=65 blue, >=50 amber, else muted). Falls back to raw `signalScore` when
  stabilityData has no entry.
- **Stability cell** (`text-center hidden lg:table-cell`): renders
  `<StabilityBadge stability={stabilityData?.[s.symbol]?.stability ?? "NEW"} smoothedScore={stabilityData?.[s.symbol]?.smoothedScore} />`
  — shows the colored stability pill + "SM: NN" subtext.

### 8. Consensus warning in Symbol cell (lines ~2881-2883)
Below the symbol name + longName, in momentum mode only, if the stock does
NOT have consensus (`!stabilityData?.[s.symbol] || !stabilityData[s.symbol].consensus`),
renders `<div className="text-[9px] text-amber-600 font-semibold mt-0.5">⚠ NEW</div>`.
This catches both brand-new stocks (no stabilityData entry) and stocks that
appeared in <2 of the last 3 runs.

### 9. Table render loop uses sortedTop10 (line ~2875)
Changed `{screen.top10.map((s: any) => (` → `{sortedTop10.map((s: any) => (`
so the "Smoothed" sort toggle actually re-orders the visible rows. The `#`
column still shows `s.rank` (original signal-score rank) so users can see
both rankings.

## Pre-existing behavior preserved
- Loading state, not-yet-run state, error/warning banner, stats grid,
  change history, trade plan cards, position history, watchlist, telegram
  settings — all untouched.
- Bridge mode table — completely untouched (new columns/cells are inside the
  `screenMode !== "bridge"` branch of the existing ternary; the shared Symbol
  cell and star/analyze cells are outside it and guarded by
  `screenMode !== "bridge"` conditions).
- All existing momentum columns (Sector, Price, RSI, MCap, returns, Sharpe,
  Setup, Signal, Trend, Stop, R:R, Vol) preserved in original order.

## Lint fix applied
First lint run flagged `react-hooks/preserve-manual-memoization` on the
`sortedTop10` useMemo because the body used `screen.top10` (non-optional) on
the return line while the dep array had `screen?.top10`. Fixed by capturing
`const top10 = screen?.top10 ?? []` once and using `top10` consistently in
both memos' bodies and dep arrays. Lint now clean.

## Verification
- `bun run lint` → clean (no warnings/errors).
- `npm run dev` → `GET / 200 in 4.3s` (compile clean, no runtime errors).

## Notes for downstream agents
- `stabilityData` shape (from parent useMemo, lines ~723-770):
  `Record<string, { smoothedScore: number; stability: "STABLE"|"VOLATILE"|"ERRATIC"|"NEW"; consensus: boolean; appearances: number; prevRanks: number[] }>`
  — but typed as `Record<string, any>` in the ScreenPanel prop for safety
  (may be `{}` when `screenHistory.length === 0`).
- When `stabilityData` is `{}` (first run, no history), every stock shows a
  blue `NEW` badge, raw `signalScore` in the Smooth column, and a `⚠ NEW`
  warning — this is the intended "all unproven" state.
- The `StabilityBadge` component is module-scope (hoisted), so it can be
  referenced from ScreenPanel even though it is defined before ScreenPanel.
- `sortBy` is local ScreenPanel state — resets to `"signal"` whenever the
  component unmounts (e.g. switching tabs). This is acceptable since the
  sort preference is a transient view setting.
