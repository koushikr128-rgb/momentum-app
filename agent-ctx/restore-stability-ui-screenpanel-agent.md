# Task: restore-stability-ui

## Summary
Restored stability / smoothing UI columns to the screen table in `src/app/page.tsx`.

## Changes
1. Added `StabilityBadge` helper component right before `ScreenPanel` (lines ~2472-2490). Renders a color-coded stability pill (STABLE/VOLATILE/ERRATIC/NEW) plus an optional "SM:" smoothed-score subtitle.
2. Updated `ScreenPanel` function signature (line ~2493): added `stabilityData` to both the destructured props and the inline type (`stabilityData?: Record<string, any>`).
3. Added two new column headers inside the momentum branch of the screen table header (right after `<TableHead className="text-right">Signal</TableHead>`):
   - `<TableHead className="text-right">Smooth</TableHead>`
   - `<TableHead className="text-center">Stability</TableHead>`
4. Added the corresponding two cells inside the momentum body (after the `<SignalScoreBadge score={s.signalScore} />` cell):
   - Smooth cell renders `SignalScoreBadge` with `stabilityData?.[s.symbol]?.smoothedScore ?? s.signalScore` (falls back to raw signal score when stability data is missing).
   - Stability cell renders `<StabilityBadge>` with `stabilityData?.[s.symbol]?.stability ?? "NEW"` and the optional smoothedScore.
5. Added a "⚠ NEW" consensus warning below the `longName` div inside the shared Symbol TableCell. The warning is conditionally rendered only when `screenMode !== "bridge"` AND the stock has no stabilityData entry or no `consensus` flag. This makes the symbol cell branch on mode without breaking the bridge layout.

## Verification
- Dev server restarted cleanly.
- `curl http://127.0.0.1:3000/` → HTTP 200.
- `bun run lint` → no errors.
- Stability columns only appear in momentum mode (inside the `screenMode !== "bridge"` branch of the header/body ternary).
- Used optional chaining (`stabilityData?.[s.symbol]`) throughout to safely handle undefined entries.

## Notes
- The Symbol TableCell is shared by both bridge and momentum modes; the "⚠ NEW" warning is gated by `screenMode !== "bridge"` so bridge rows are unaffected.
- No existing code was modified beyond the additive inserts specified in the task.
