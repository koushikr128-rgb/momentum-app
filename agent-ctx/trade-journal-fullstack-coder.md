# Task: trade-journal — Trade Journal + Position Tracker

**Agent**: fullstack-coder
**Task ID**: trade-journal
**Date**: 2026-11-04
**File modified**: `/home/z/my-project/src/app/page.tsx`

## Summary

Added a complete paper-trade tracking layer to the Nifty Momentum Tracker dashboard:
open positions from a Buy button on each stock row, track live P&L against stop/target,
close positions with an inline form (exit price + reason), and review the closed-trade
journal with summary stats and win-rate-by-setup breakdown.

## What was changed

### 1. New types (after `CorrelationResponse`, around line 162)
- `Position` — open position record (id, symbol, entryPrice, shares, entryDate,
  stopPrice, target1, target2, setupType, setupGrade, signalScore, rrMultiplier, sector)
- `ClosedTrade` — closed trade record (Position fields + exitPrice, exitDate,
  pnlRupees, pnlPct, holdDays, exitReason)

### 2. State + localStorage + helpers in `Home` component (after watchlist state, ~line 582)
- `positions: Position[]`, `closedTrades: ClosedTrade[]`, `positionPrices: Record<string, number>`
- `positionPricesLoading: boolean` (for the refresh button spinner)
- Load effects: `nifty_positions`, `nifty_closed_trades` (on mount)
- Save effects: persist on every change
- `openPosition(stock)` — auto-logs entry=currentPrice, stop=stopPrice,
  targets = currentPrice + risk × rrMultiplier.t1/t2 (from `getRRForSetup`),
  shares = Math.floor(10000 / currentPrice) (≈₹10k per position)
- `closePosition(positionId, exitPrice, reason)` — computes P&L ₹/%,
  holdDays, moves the position into `closedTrades`, cleans up `positionPrices`
- `isPositionOpen(symbol)` — used by Buy button to show OPEN badge vs Buy button
- `refreshPositionPrices()` — POSTs to `/api/refresh-prices` with all position
  symbols + optional kite token, merges returned prices into `positionPrices`

### 3. ScreenPanel props
Updated both the `<ScreenPanel>` call (line ~1522) and the `ScreenPanel`
function signature (line ~2642) to accept:
`positions, openPosition, closePosition, isPositionOpen, positionPrices,
refreshPositionPrices, positionPricesLoading, closedTrades`

### 4. Buy button (momentum mode only)
- New `<TableHead className="text-center">Buy</TableHead>` BEFORE the star header
  (only when `screenMode !== "bridge"`)
- New `<TableCell>` BEFORE the star cell that shows either:
  - `<Badge>OPEN</Badge>` if `isPositionOpen(s.symbol)` is true
  - `<Button>Buy</Button>` (with Wallet icon, emerald outline) that calls `openPosition(s)`
- The Buy column never appears in bridge mode

### 5. PositionsCard component (new, after WatchlistCard definition)
- Title: "📋 Open Positions" + count badge
- Header-right: "Refresh Prices" button (only shown when positions exist)
- Empty state: "No open positions. Click 'Buy' next to any stock to open a position."
- Position table columns: Symbol (+ setup badge), Entry ₹, Current ₹, Shares,
  P&L ₹ (green/red), P&L % (green/red), Stop ₹ (red, hidden md+),
  T1 ₹ (green, hidden md+), T2 ₹ (green, hidden lg+), Status badge, Close button
- Status badge logic (priority order): Near SL → Near T2 → Near T1 → At Entry → —
  - "Near" = within 2% of stop/target
  - "At Entry" = within 1% of entry
- Close button opens an INLINE form (extra TableRow with colSpan=11) containing:
  - Exit Price input (auto-filled with live/entry price)
  - Exit Reason Select (Target 1, Target 2, Stop Loss, Manual)
  - Live P&L preview (₹ + %)
  - Cancel + Confirm Close buttons
- Enter key confirms, Escape cancels
- Uses React `Fragment` keyed by position id to return main row + optional close-form row

### 6. TradeJournalCard component (new, after PositionsCard)
- Title: "📊 Trade Journal" + count badge
- Empty state: "No closed trades yet. Open and close positions to build your journal."
- Summary stats (4 boxes): Total Trades (with W/L), Win Rate, Total P&L ₹, Avg Hold Days
- Closed-trades table (most recent first): Symbol (+ longName), Setup, Entry Date,
  Exit Date, Hold (d), Entry ₹, Exit ₹, P&L ₹ (colored), P&L % (colored), Exit Reason badge
- Exit reason badges: Target 1/Target 2 = emerald, Stop Loss = red, Manual = slate
- "Win Rate by Setup" mini-summary: each setup with win rate and W/total
  (e.g., "BREAKOUT: 100% (1/1)"), color-coded by win rate (≥60% green, ≥40% amber, else red)

### 7. Rendering in ScreenPanel
Inserted `<PositionsCard>` and `<TradeJournalCard>` between `<ScreenHistoryCard>`
and `<WatchlistCard>` (line ~3089). Both components only render after a screen has
been run, because they live in the "screen exists" branch of ScreenPanel (the
loading and not-yet-run branches early-return).

### 8. Import addition
Added `Fragment` to the React import on line 3 (needed for keyed Fragment
when returning sibling TableRows from a `.map()`).

## Verification

- **Lint**: `bun run lint` shows 21 pre-existing errors all about the `SortIcon`
  component declared inside `ScreenPanel` (line 2675). None are introduced by
  this change.
- **Dev server**: restarted successfully, `GET /` returns HTTP 200, no errors
  in `dev.log`.
- **JS bundle**: confirmed `PositionsCard`, `TradeJournalCard`, `openPosition`,
  `closePosition`, `isPositionOpen`, `nifty_positions`, `nifty_closed_trades`
  all present in compiled chunk.
- **End-to-end UI test** (via agent-browser, after injecting a fake screen into
  localStorage):
  1. Verified "📋 Open Positions", "📊 Trade Journal", empty-state messages,
     and "Buy" button all rendered.
  2. Clicked "Buy" on RELIANCE row → position opened, toast shown, "OPEN" badge
     replaced Buy button, `nifty_positions` in localStorage has 1 entry with
     correct entry=2950, shares=3, stop=2820, target1=3145, target2=3340,
     rrMultiplier={t1:1.5, t2:3}.
  3. Clicked "✕ Close" → inline form appeared with Exit Price (default 2950),
     Exit Reason dropdown (default "Manual"), Preview P&L = "+₹0 (+0.0%)".
  4. Filled Exit Price = 3145 → Preview P&L updated to "+₹585 (+6.6%)".
  5. Clicked "Confirm Close" → position removed from open list, new entry
     appended to `nifty_closed_trades` with exitPrice=3145, pnlRupees=585,
     pnlPct=6.61, holdDays=0, exitReason="Manual".
  6. Trade Journal summary updated: Total Trades=1, 1W/0L, Win Rate=100%,
     Total P&L ₹=+₹585, Avg Hold Days=0.0.
  7. "Win Rate by Setup" section shows "BREAKOUT: 100% (1/1)".

## Persistence keys
- `nifty_positions` — open positions array
- `nifty_closed_trades` — closed trades array

## Files changed
- `/home/z/my-project/src/app/page.tsx` — single file, all changes contained here
