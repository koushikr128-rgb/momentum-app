# Task: watchlist-telegram-ui

**Agent**: Z.ai Code (fullstack)
**File edited**: `/home/z/my-project/src/app/page.tsx`
**Result**: ✅ Home route returns HTTP 200, `bun run lint` clean

## What was done

### 1. ScreenPanel signature (line ~2438)
Extended the destructured props + inline type to add:
`watchlist`, `addToWatchlist`, `removeFromWatchlist`, `isInWatchlist`,
`onAnalyzeWatchlist`, `telegramConfig`, `setTelegramConfig`, `sendTelegramAlert`.
All optional. The Home component (line ~1338) was already passing these props,
so they are now actually consumed by ScreenPanel.

### 2. Star button in the Top-10 table (header + body)
- Added one `<TableHead>` with a muted `<Star>` icon right before the existing
  `Analyze` header. Because the Analyze header sits outside the
  `screenMode === "bridge" ? ... : ...` conditional, the star header is shared
  by BOTH momentum and bridge modes.
- Added one `<TableCell>` containing a `h-7 w-7 p-0` ghost `<Button>` with a
  `<Star>` icon. Also placed before the Analyze cell, so it renders for both
  modes. The star is filled yellow (`text-yellow-500 fill-yellow-400`) when
  `isInWatchlist(s.symbol)` is true, otherwise outline gray
  (`text-muted-foreground`). Click toggles: `removeFromWatchlist(s.symbol)` if
  in list, else `addToWatchlist(s)`. Includes `title` tooltip for a11y.

### 3. WatchlistCard component (defined after ScreenPanel, before ScreenHistoryCard)
- Title: `⭐ Watchlist` with a count `<Badge>`.
- Empty state: dashed box with "No stocks in watchlist. Click the star icon
  next to any stock to add it."
- Populated state: compact `<Table>` (`max-h-96 overflow-y-auto`) with columns
  Symbol (bold) · Setup (`SetupBadge`, cast `setupType as SetupType`) · Signal
  (`SignalScoreBadge`) · Price (`₹{fmt(w.price)}`) · Added (`fmtISTDate`) ·
  Actions (🔍 Analyze button → `onAnalyze(w.symbol)`, ✕ Remove button →
  `onRemove(w.symbol)`).
- Rendered in ScreenPanel's main return, right after `<ScreenHistoryCard>`.

### 4. TelegramSettingsCard component (defined after WatchlistCard)
- Title: `Telegram Alerts` with a `<Send>` icon + enable/disable `<Switch>`
  bound to `config.enabled` via `setConfig`.
- Disabled (collapsed) view: dashed box "Enable the switch and Configure below
  to receive alerts."
- Enabled view: `Bot Token` (`type=password`, monospace, placeholder
  `123456789:ABCdef...`), `Chat ID` (`type=text`, placeholder
  `your_chat_id`), help text "Create a bot with @BotFather, then get your chat
  ID from @userinfobot", and a `Send Test Alert` button that calls
  `sendAlert("✅ Test alert from Momentum Dashboard!")` and shows a success
  toast (or destructive toast if fields are empty / send fails). Uses a local
  `sending` state for the button's disabled/loading label.
- Rendered in ScreenPanel's main return, right after `<WatchlistCard>`.

## Pre-existing bug fixed (minimal, required for build)
The watchlist/telegram state block (added in a prior step) declared a second
`const lastAlertedRef = useRef("")` at line ~582, colliding with the original
`lastAlertedRef` at line ~385 (used by the browser-notification alerting at
lines ~932/933). This duplicate broke Turbopack compilation
(`the name 'lastAlertedRef' is defined multiple times`, HTTP 500).
Renamed the **telegram** one to `lastTelegramAlertedRef` (declaration + 2
usages) so both independent alert-dedup refs coexist. No other logic changed.

## Verification
- `bun run lint` → clean (no warnings/errors).
- `npm run dev` → `GET / 200 in 4.0s` (compile clean, no runtime errors).
- Existing ScreenPanel behavior (loading / not-yet-run / results states,
  momentum vs bridge table, change history, trade plan cards, position
  history) all preserved — only additive changes plus the one rename.

## Notes for downstream agents
- `WatchlistCard` / `TelegramSettingsCard` are module-scope function
  components (hoisted), so they can be referenced from `ScreenPanel` even
  though they are defined after it.
- `WatchlistItem.setupType` is typed as `string`; it is cast to `SetupType`
  when handed to `SetupBadge`. `SetupBadge` already falls back to `UPTREND`
  for unknown values, so stale localStorage entries with old setup names
  won't crash.
- The star column is added **once** (outside the bridge/momentum conditional),
  so it appears in both modes automatically.
