---
Task ID: momentum-screen-1
Agent: main (Super Z)
Task: Build a re-runnable momentum screener on the Nifty Total Market index applying 6 rules (Price>200DMA, Price>50DMA, 50DMA>200DMA, RSI(14)>55, MCap>500Cr, 30D Vol>50k), sorted by 6M return DESC, Top 10, output as styled Excel.

Work Log:
- Loaded xlsx skill (SKILL.md, scenes/create.md, engines/design.md, quality/pipeline.md).
- Installed yfinance 1.7.0 + openpyxl 3.1.5 into /home/z/.venv.
- Hardcoded a ~370-symbol NSE universe (covering breadth of Nifty Total Market).
- Wrote /home/z/my-project/scripts/nifty_momentum_screen.py:
  - Batch yfinance download (18mo OHLCV) with retries for transient "database locked" errors.
  - Per-stock indicator engine: 50DMA, 200DMA, RSI(14) Wilder, 1M/3M/6M returns, annualized vol (√252), Sharpe (rf=0), 52W H/L, % below high, % above 200DMA, 30D avg volume.
  - Two-stage filter: technical+volume first (cheap, no .info needed) → then fetch market cap + sector via .info on filtered set only (efficient).
  - Excel builder uses xlsx skill design system (B2 canvas origin, professional palette, alternating rows, header line, embedded bar chart of 6M returns).
- Ran screen on 2026-09-28. 312 stocks had enough data; 17 passed technical+volume filter; 17 passed market-cap filter; Top 10 selected.
- Validated Excel via xlsx.py validate → status: passed, 0 issues.

Stage Summary:
- Deliverable: /home/z/my-project/download/nifty_momentum_screen_2026-09-28.xlsx (11 KB)
  - Sheet 1 "Top 10 Momentum Stocks": ranked table with 19 metric columns + embedded bar chart of 6M returns
  - Sheet 2 "Methodology": all 6 rules + run notes
- Re-runnable script: /home/z/my-project/scripts/nifty_momentum_screen.py (re-run with `python3 /home/z/my-project/scripts/nifty_momentum_screen.py` — fetches fresh data each time, writes a date-stamped file)
- Top 3 results: RAYMOND (+245% 6M, RSI 85.6), WELCORP (+230% 6M, RSI 60.2), FILATEX (+199% 6M, RSI 74.4)
- Runtime: ~45s per run (universe download + .info on filtered set only)

---
Task ID: restore-phase1-ui
Agent: main (Super Z)
Task: Restore Phase 1 signal-platform features to /home/z/my-project/src/app/page.tsx — wire up the restored backend (regime + analyze + new ScreenedStock fields) to the dashboard UI, adding a Market Regime banner, an Analyze tab, full trade-plan cards with adjustable R:R, and setup/signal/volume badges across the screen table.

Work Log:
- Read worklog.md and existing page.tsx (2407 lines, 6 tabs: screen/alloc/stops/stress/backtest/risk) for context.
- Confirmed backend already restored: src/lib/indicators.ts has SetupType/SetupGrade/signalScore/entryPrice/addPrice/stopPrice/target1/target2/riskReward/volMult/pctAbove20dma/vsaTag/bollingerWidth/bbWidth6mPct/dma20/ret1wPct; src/lib/regime.ts exists with RegimeState + classifyRegime; /api/regime and /api/analyze routes exist; Python backend has cmd_nifty + cmd_analyze.
- Confirmed /api/zerodha/token returns { access_token } in the response body — needed for client-side localStorage + x-kite-token header.
- Imported `Search` icon from lucide-react; imported `SetupType`, `SetupGrade` from @/lib/indicators and `RegimeState` type from @/lib/regime.
- Added to Home component:
  - `kiteAccessTokenRef` ref + `regime`/`regimeLoading`/`regimeError` state
  - `analyzeSymbol`/`analyzeInput`/`analyzeData`/`analyzeLoading`/`analyzeError`/`analyzeSuggestions` state
  - `rrOverride` state (null = use per-setup presets)
  - `fetchRegime` callback that calls `/api/regime` with `x-kite-token` header from kiteAccessTokenRef
  - `runAnalyze` callback that calls `/api/analyze?symbol=X`
  - Mount useEffect: restore kite token from localStorage, check `/api/zerodha/status` (set kiteConnected or clear expired token), call fetchRegime()
  - Auto-retry useEffect: every 30s while regime.niftyClose === 0
- Updated Zerodha connection handlers (both the auto-redirect path ~line 222 and the manual paste path ~line 1180):
  - After successful POST to /api/zerodha/token, read `data.access_token` from response body
  - Store via localStorage.setItem("kite_access_token", ...) and kiteAccessTokenRef.current = ...
  - Call fetchRegime() after 500ms
- Added 7th tab "Analyze" between "alloc" and "stops" in both the desktop nav (grid-cols-6 → grid-cols-7) and mobile bottom nav (grid-cols-6 → grid-cols-7).
- Added RegimeBanner at the top of <main> before the <Tabs>:
  - If regime.niftyClose === 0 → amber "CHOP · 50% size (limited data)" card with retry button
  - Otherwise colored card (green RISK-ON / red RISK-OFF / amber CHOP / purple TRANSITION) with regime label, NIFTY price + %, position-size multiplier, breadth%, vol%, recommendation text, refresh button
  - Receives regime, regimeLoading, regimeError, fetchRegime as props
- Added new components before ScreenPanel:
  - `RR_PRESETS` constant matching indicators.ts (BREAKOUT 1.5/3.0, PULLBACK 1.5/2.5, EXTENDED 1.0/2.0, DISTRIBUTION 0.7/1.5, TIGHTENING 1.5/2.5, UPTREND 1.5/2.8)
  - `getRRForSetup(setupType, override?)` helper
  - `SetupBadge({type, grade})` — emoji + label badge + grade chip (A+/A/B/C)
  - `SignalScoreBadge({score})` — colored 0-100 number (green≥80, blue≥65, amber≥50, gray<50)
  - `VolMultBadge({mult, tag})` — volume multiplier + ACCUM/DIST/NEUTRAL tag
  - `tradePlanRationale(s)` — explains why this setup was chosen, per-setup-type text
  - `TradePlanSettings({override, setOverride})` — slider panel with T1 (0.5-3.0) and T2 (1.0-5.0) range inputs, "Override globally" / "Reset to per-setup" toggle, blended R:R + expectancy display
  - `TradePlanField({label, value, tone})` — tone-colored value cell
  - `TradePlanCard({stocks, regime, rrOverride, setRrOverride})` — grid of trade plan cards for top stocks (entry/add/stop/T1/T2/R:R/pos-size/risk-₹/T2-gain), with TradePlanSettings at top; targets recomputed client-side via getRRForSetup
  - `RegimeBanner({regime, loading, error, onRefresh})` — as described above
  - `Metric({label, value, hint})` — small metric tile
  - `ReturnRow({label, pct})` — return row with ReturnCell
  - `SetupExplanation({s})` — checklist card showing why this setup was chosen (uptrend, RSI zone, % above MAs, vol mult, VSA tag, BB width)
  - `AnalyzeResultCard({data, regime, rrOverride, setRrOverride})` — header card + Trade Plan card + Technicals grid + Returns grid + "Why this setup?" explanation card
  - `AnalyzePanel({input, setInput, onAnalyze, symbol, data, loading, error, regime, suggestions, rrOverride, setRrOverride})` — search input + quick-pick chips + error card (with suggestions) + loading state + empty state + AnalyzeResultCard
- Updated ScreenPanel to accept `regime`, `onAnalyze`, `rrOverride`, `setRrOverride` props and:
  - Added TradePlanCard section before the top-10 table showing top 5 stocks with full trade plans
  - Added new columns to the screen table: Setup (badge), Signal (score), R:R (T2 ratio), Vol (multiplier+VSA tag)
  - Added 🔍 Analyze button on each row that calls `onAnalyze(symbol)` (switches to Analyze tab and runs analysis)
  - Updated sort description to "Ranked by composite Signal Score (0-100)"
- Preserved all existing rules:
  - No auto-refresh of screen on mount (stocks only change when user clicks Run Screen, auto-refresh is on, or filters change) — verified no bare runScreen() call
  - All times in IST (existing fmtISTTime/fmtISTDateTime/fmtISTDate helpers reused)
  - Zerodha as primary data source (when connected) — kiteAccessTokenRef sent as x-kite-token header to /api/regime
  - No Holdings tab added — only the 7 tabs (screen/alloc/analyze/stops/stress/backtest/risk)
  - Change History still works (unchanged)
- Installed yfinance 1.7.0 + curl_cffi + multitasking + peewee + protobuf into /home/z/.venv so the Python backend (cmd_nifty + cmd_analyze) can actually fetch live data (the system python3 didn't have yfinance installed).
- Removed an unused eslint-disable directive flagged by ESLint.
- Lint passes with 0 errors and 0 warnings.

Stage Summary:
- Deliverable: /home/z/my-project/src/app/page.tsx — now 2686 lines (was 2407), 7 tabs (added Analyze), with full Phase 1 signal-platform UI.
- Verification:
  - Home page (GET /): HTTP 200 (SSR renders RegimeBanner + all tabs)
  - /api/analyze?symbol=RELIANCE: HTTP 200 — returns full ScreenedStock JSON with setupType=UPTREND, setupGrade=C, signalScore=51, entryPrice=1214.10, addPrice=1203.01, stopPrice=1236.63, target1/target2, volMult, vsaTag, bollingerWidth, bbWidth6mPct, dma20, ret1wPct, etc.
  - /api/regime: HTTP 200 — returns regime=RISK-OFF, niftyClose=23021.20, niftyChangePct=+1.76%, breadthPct=26.09%, volatilityPct=13.95%, sizeMultiplier=0.25 (full data, not limited)
  - `bun run lint`: 0 errors, 0 warnings
- User-visible behavior:
  - Top of every tab: RegimeBanner showing live NIFTY regime + size multiplier + breadth + volatility + recommendation (or amber "limited data" card with retry button if backend unavailable)
  - Screen tab: TradePlanCard at top showing top 5 stocks with full entry/add/stop/T1/T2/R:R/position-size/risk-₹/T2-gain cards + adjustable R:R sliders; expanded screen table with Setup badge, Signal score, R:R, Vol multiplier+VSA tag, and per-row 🔍 Analyze button
  - Analyze tab: search any NSE symbol, get header card + full trade plan + technicals grid + returns grid + "Why this setup?" explanation card; supports quick-pick chips and "Did you mean?" suggestions on failure
  - Trade Plan card and Analyze result card both honor the global R:R override (slider) and recomputes targets/position-size client-side from entryPrice + stopPrice
- Issues encountered:
  - yfinance was not installed in the venv when the sandbox was reset (worklog referenced an install from a previous session). Installed fresh — both /api/regime and /api/analyze now work end-to-end with live NIFTY + stock data.
  - Initial run had a "RegimeBanner is not defined" SSR error because the RegimeBanner was rendered before its function declaration was added in the same edit pass; resolved by inserting all Phase 1 components before ScreenPanel.
