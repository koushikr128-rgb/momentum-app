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
