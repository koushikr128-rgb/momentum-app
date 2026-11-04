# Task: position-manual-edit — PositionsCard Manual Entry + Edit

**Agent:** frontend-coder
**Task ID:** position-manual-edit
**File modified:** `/home/z/my-project/src/app/page.tsx`
**Date:** 2025-01

## Goal
Add manual position entry + inline edit functionality to the `PositionsCard` component,
wired through `ScreenPanel` to the already-existing parent handlers `manualOpenPosition`
and `updatePosition` (defined in the top-level page component).

## Context — Pre-existing Parent Handlers
The parent page component already defines and (after this change) already passes two
callbacks into `ScreenPanel`:
- `manualOpenPosition(data: { symbol; entryPrice; shares; stopPrice?; target1?; target2?; setupType? })`
  - Uppercases symbol, strips `.NS` suffix
  - Rejects duplicates
  - Defaults stop to `entry * 0.95` (5% below) when not provided
  - Defaults T1/T2 from `getRRForSetup(setupType, rrOverride)` when not provided
  - Persists a new `Position` into `positions` state
- `updatePosition(positionId, updates: Partial<Position>)`
  - Shallow-merges updates into the matching position

The parent call site (line ~1581) was already passing `manualOpenPosition={...}` and
`updatePosition={...}` to `<ScreenPanel>` — only `ScreenPanel` and `PositionsCard` needed
to actually receive and use them.

## Changes Made

### 1. Imports (line ~17-22)
Added `Plus` and `Pencil` icons to the existing `lucide-react` import:
```ts
import {
  Activity, ArrowDown, ArrowUp, RefreshCw, AlertTriangle,
  ShieldAlert, TrendingUp, TrendingDown, Gauge, Wallet, Target, Zap, Timer, Clock,
  Bell, BellRing, History, GitCompare, SlidersHorizontal, Search, Star, Send,
  Plus, Pencil,
} from "lucide-react";
```

### 2. `ScreenPanel` function signature (line ~2701)
Extended the destructured props and the inline type literal to accept:
```ts
manualOpenPosition?: (data: { symbol: string; entryPrice: number; shares: number;
  stopPrice?: number; target1?: number; target2?: number; setupType?: string }) => void;
updatePosition?: (positionId: string, updates: Partial<Position>) => void;
```

### 3. `<PositionsCard>` call inside `ScreenPanel` (line ~3149)
Added two new prop bindings:
```tsx
<PositionsCard
  positions={positions || []}
  positionPrices={positionPrices || {}}
  onRefreshPrices={refreshPositionPrices}
  refreshing={!!positionPricesLoading}
  onClose={closePosition}
  onManualOpen={manualOpenPosition}
  onUpdate={updatePosition}
/>
```

### 4. `PositionsCard` function (line ~3259)
Replaced the whole function with an extended version that:

#### New signature
```tsx
function PositionsCard({ positions, positionPrices, onRefreshPrices, refreshing,
  onClose, onManualOpen, onUpdate }: {
  positions: Position[];
  positionPrices: Record<string, number>;
  onRefreshPrices?: () => void;
  refreshing?: boolean;
  onClose?: (positionId: string, exitPrice: number, reason: string) => void;
  onManualOpen?: (data: { symbol: string; entryPrice: number; shares: number;
    stopPrice?: number; target1?: number; target2?: number; setupType?: string }) => void;
  onUpdate?: (positionId: string, updates: Partial<Position>) => void;
}) { ... }
```

#### New state
- `showAddForm` (boolean) — toggles inline Add-Position form above the table
- `addForm` — `{ symbol, entryPrice, shares, stopPrice, target1, target2, setupType }`,
  default `setupType: "MANUAL"`
- `editingId` (string | null) — which position row's inline edit form is open
- `editForm` — `{ shares, entryPrice, stopPrice, target1, target2 }`

#### New handlers
- `resetAddForm()`, `cancelAdd()`, `confirmAdd()` — validates symbol/entryPrice/shares,
  also validates optional stop/targets if provided, then calls `onManualOpen?.({...})`
- `startEdit(p)` — pre-fills `editForm` from the position, closes any open close form
- `cancelEdit()`, `confirmEdit(p)` — validates shares/entryPrice and optional fields,
  then calls `onUpdate?.(p.id, { shares, entryPrice, stopPrice, target1, target2 })`
- `startClose(p)` — also now closes any open edit form (mutual exclusion between
  edit and close forms on the same row)

#### UI — Header
Two buttons now sit in a `flex items-center gap-1.5 shrink-0` container:
1. **Add Position** (emerald outline) — toggles `showAddForm`. Label collapses to
   `+` / `✕` on mobile.
2. **Refresh Prices** (blue outline) — unchanged, only shown when positions exist.

#### UI — Inline Add Form (above table, when `showAddForm && onManualOpen`)
A bordered emerald-tinted panel with a responsive 7-field grid
(`grid-cols-2 sm:grid-cols-4 lg:grid-cols-7`):
- Symbol (text, auto-uppercased, placeholder `EBGNG`, autofocus)
- Entry ₹ (number, placeholder `723`)
- Shares (number, placeholder `10`)
- Stop ₹ (number, optional, placeholder `defaults 5% below`)
- Target 1 ₹ (number, optional, placeholder `optional`)
- Target 2 ₹ (number, optional, placeholder `optional`)
- Setup Type — `Select` with BREAKOUT / PULLBACK / UPTREND / MANUAL (default MANUAL)

All inputs handle `Enter` (submit) and `Escape` (cancel) via `onKeyDown`.
Footer has `Cancel` + emerald `Add` buttons.

#### UI — Empty state
Now adaptive: when `showAddForm` is true and there are no positions, the empty state
reads *"Fill the form above and click Add to create your first position."* instead of
the usual empty message.

#### UI — Position row "Actions" cell
Replaced single Close button with a 2-button inline-flex group:
1. **Edit** (amber outline, `Pencil` icon) — toggles `startEdit`/`cancelEdit`.
   Disabled while the close form is open on the same row. Label collapses to icon-only
   on mobile (`< sm`).
2. **Close** (red outline) — unchanged behavior. Disabled while the edit form is open
   on the same row.

Header column renamed `Close` → `Actions`.

#### UI — Inline Edit Form (extra `<TableRow>` below the edited row, colSpan 11)
Amber-tinted panel mirroring the close-form layout. Fields (all prefilled from the
position being edited): Shares, Entry ₹, Stop ₹, T1 ₹, T2 ₹.
Shows a live **Preview P&L** computed from the edited entry price + shares against
the current market price.
Footer has `Cancel` + amber `Save` buttons.

## Validation
- `bun run lint` — no new errors introduced. The 21 pre-existing
  `react-hooks/static-components` errors are all in the `SortIcon` component
  declared inside `ScreenPanel` (line ~2735) and its usages in the StockList table
  (lines 2998-3028). They are unrelated to this task and were present before.
- Dev server restarted cleanly (`pkill -9 -f next` → `npm run dev`):
  `Home: HTTP 200`, `✓ Ready in 695ms`, no compile errors in `dev.log`.

## Notes for Next Agent
- The parent already had `manualOpenPosition` + `updatePosition` wired into
  `<ScreenPanel>` — only `ScreenPanel`'s signature and `PositionsCard` needed
  updates to consume them.
- Forms use `onKeyDown` Enter/Escape for power-user keyboard flow.
- Edit and Close forms are mutually exclusive per-row (opening one closes the other).
- The "Add Position" button is always visible (even with 0 positions) so users can
  bootstrap their first manual position without going through the screener.
