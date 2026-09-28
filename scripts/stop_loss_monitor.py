"""
Stop-Loss Monitor — Live Position Tracker for Top-10 Holdings
==============================================================
Reads the latest portfolio_allocation_*.xlsx, re-fetches fresh OHLCV for
each holding, and applies 3 stop rules:

  Rule 1 (Trend break) : CLOSE < 50 DMA             → EXIT
  Rule 2 (Hard stop)   : Price ≤ entry − 8%         → EXIT
  Rule 3 (Trailing)    : Price ≤ peak_since_entry × 0.85  → EXIT

  WATCH : any stop within 2% of trigger
  HOLD  : all stops intact, healthy distance

Output: stop_loss_monitor_<date>.xlsx with status table.
"""
from __future__ import annotations
import os, sys, glob, time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
from openpyxl import load_workbook

DOWNLOAD_DIR = Path("/home/z/my-project/download")
SCRIPT_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------- find latest allocation
candidates = sorted(DOWNLOAD_DIR.glob("portfolio_allocation_*.xlsx"))
if not candidates:
    print("No portfolio_allocation_*.xlsx found — run portfolio_allocation.py first.")
    sys.exit(1)
alloc_path = candidates[-1]
print(f"Reading allocation: {alloc_path.name}")

# ---------------------------------------------------------------- read holdings
wb = load_workbook(alloc_path, data_only=True)
ws = wb["Allocation"]
header_row = [ws.cell(row=4, column=c).value for c in range(2, 14)]
rows = []
for r in range(5, 15):
    row = [ws.cell(row=r, column=c).value for c in range(2, 14)]
    if row[0] is None or row[1] is None:
        break
    rows.append(row)

df = pd.DataFrame(rows, columns=header_row)
for c in df.columns:
    if c not in ("Symbol", "Sector", "Notes"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.rename(columns={"Price (₹)": "entry_price", "Weight %": "weight",
                         "₹ Amount": "rupees", "Shares": "shares",
                         "6M Ret %": "ret_6m", "RSI(14)": "rsi_entry",
                         "Ann Vol %": "ann_vol", "Sharpe": "sharpe"})

print(f"\nLoaded {len(df)} holdings. Fetching fresh data...")

# ---------------------------------------------------------------- fetch fresh OHLCV
tickers = [f"{s}.NS" for s in df["Symbol"].tolist()]
fresh = yf.download(tickers, period="6mo", interval="1d",
                    group_by="ticker", threads=True, progress=False)

# ---------------------------------------------------------------- apply stops
HARD_STOP_PCT = -0.08   # -8% from entry
TRAILING_PCT  = -0.15   # -15% from peak since entry
WATCH_BAND    = 0.02    # within 2% of any stop → WATCH

records = []
for _, h in df.iterrows():
    sym = h["Symbol"]
    tk = f"{sym}.NS"
    try:
        if isinstance(fresh.columns, pd.MultiIndex):
            px = fresh[tk]["Close"].dropna()
        else:
            px = fresh["Close"].dropna()
    except Exception as e:
        print(f"  {sym}: data fetch failed — {e}")
        continue

    if len(px) < 50:
        print(f"  {sym}: insufficient data ({len(px)} days)")
        continue

    current = float(px.iloc[-1])
    dma_50 = float(px.tail(50).mean())
    # Peak since "entry" — entry was today's allocation, so peak is max close in fresh window
    peak = float(px.max())
    last_date = px.index[-1]

    # Compute stop levels
    hard_stop_level = h["entry_price"] * (1 + HARD_STOP_PCT)
    trailing_stop_level = peak * (1 + TRAILING_PCT)
    trend_stop_level = dma_50  # exit if close < 50 DMA

    # The most conservative stop (highest of the 3) is the active stop
    active_stop = max(hard_stop_level, trailing_stop_level, trend_stop_level)

    # Determine status
    status = "HOLD"
    reasons = []
    if current < dma_50:
        status = "EXIT"; reasons.append(f"Below 50 DMA (₹{dma_50:.2f})")
    if current <= hard_stop_level:
        status = "EXIT"; reasons.append(f"Hard stop hit (₹{hard_stop_level:.2f})")
    if current <= trailing_stop_level:
        status = "EXIT"; reasons.append(f"Trailing stop hit (₹{trailing_stop_level:.2f})")

    if status != "EXIT":
        # Check WATCH zone
        gap_to_trend = (current - trend_stop_level) / current
        gap_to_hard  = (current - hard_stop_level) / current
        gap_to_trail = (current - trailing_stop_level) / current
        min_gap = min(gap_to_trend, gap_to_hard, gap_to_trail)
        if min_gap < WATCH_BAND:
            status = "WATCH"
            if gap_to_trend < WATCH_BAND: reasons.append(f"Near 50 DMA ({(gap_to_trend*100):+.1f}%)")
            if gap_to_hard < WATCH_BAND: reasons.append(f"Near hard stop ({(gap_to_hard*100):+.1f}%)")
            if gap_to_trail < WATCH_BAND: reasons.append(f"Near trailing stop ({(gap_to_trail*100):+.1f}%)")

    # P&L vs entry
    pnl_pct = (current / h["entry_price"] - 1) * 100
    pnl_rupees = (current - h["entry_price"]) * h["shares"]

    records.append({
        "symbol": sym, "sector": h["Sector"],
        "entry_price": h["entry_price"], "current_price": current,
        "dma_50": dma_50, "peak_since_entry": peak,
        "hard_stop": hard_stop_level, "trailing_stop": trailing_stop_level,
        "trend_stop": trend_stop_level, "active_stop": active_stop,
        "pnl_pct": pnl_pct, "pnl_rupees": pnl_rupees,
        "shares": int(h["shares"]), "rupees": h["rupees"],
        "last_date": last_date, "status": status, "reasons": "; ".join(reasons),
    })

result = pd.DataFrame(records).sort_values(["status", "pnl_pct"], ascending=[True, True])
result = result.reset_index(drop=True)

# ---------------------------------------------------------------- print summary
print("\n" + "=" * 130)
print(f"STOP-LOSS MONITOR — {datetime.now():%Y-%m-%d %H:%M}  (data as of latest NSE close)")
print("=" * 130)
print(f"{'Symbol':<12}{'Entry':>10}{'Current':>10}{'50 DMA':>10}{'Peak':>10}"
      f"{'Stop':>10}{'P&L %':>9}{'P&L ₹':>11}  {'Status':<7}{'Reason'}")
print("-" * 130)
for _, r in result.iterrows():
    print(f"{r['symbol']:<12}{r['entry_price']:>10.2f}{r['current_price']:>10.2f}"
          f"{r['dma_50']:>10.2f}{r['peak_since_entry']:>10.2f}"
          f"{r['active_stop']:>10.2f}{r['pnl_pct']:>+8.2f}%{r['pnl_rupees']:>+11,.0f}  "
          f"{r['status']:<7}{r['reasons']}")

total_pnl = result["pnl_rupees"].sum()
total_invested = result["rupees"].sum()
print("-" * 130)
print(f"{'TOTAL':<12}{'':<50}{'':<10}{total_pnl/total_invested*100:>+8.2f}%{total_pnl:>+11,.0f}")

print("\n--- Status Counts ---")
for s, n in result["status"].value_counts().items():
    print(f"  {s}: {n}")

# ---------------------------------------------------------------- write Excel
out_path = DOWNLOAD_DIR / f"stop_loss_monitor_{datetime.now():%Y-%m-%d}.xlsx"
from openpyxl import Workbook
sys.path.insert(0, "/home/z/my-project/skills/xlsx/templates")
from base import (FONT_NAME, HEADER_BOLD, PRIMARY, ACCENT_POSITIVE, ACCENT_NEGATIVE,
                  ACCENT_WARNING, NEUTRAL_600,
                  setup_sheet, style_header_row, style_data_row, style_total_row,
                  auto_fit_columns)
from openpyxl.styles import Font, Alignment

wb_out = Workbook()
ws = wb_out.active
ws.title = "Stop-Loss Monitor"
ws.sheet_view.showGridLines = False

headers = ["Symbol", "Sector", "Entry ₹", "Current ₹", "50 DMA ₹",
           "Peak ₹", "Active Stop ₹", "P&L %", "P&L ₹",
           "Shares", "₹ Allocated", "Status", "Reasons"]
last_col = len(headers) + 1
setup_sheet(ws, title=f"Stop-Loss Monitor — {datetime.now():%Y-%m-%d}  (latest NSE close)",
            last_col=last_col)
for i, h in enumerate(headers, start=2):
    ws.cell(row=4, column=i, value=h)
style_header_row(ws, row_num=4, col_start=2, col_end=last_col)

status_colors = {"HOLD": ACCENT_POSITIVE, "WATCH": ACCENT_WARNING, "EXIT": ACCENT_NEGATIVE}
for i, (_, r) in enumerate(result.iterrows()):
    rn = 5 + i
    cells = [r["symbol"], r["sector"], round(r["entry_price"], 2),
             round(r["current_price"], 2), round(r["dma_50"], 2),
             round(r["peak_since_entry"], 2), round(r["active_stop"], 2),
             round(r["pnl_pct"], 2), round(r["pnl_rupees"], 0),
             int(r["shares"]), round(r["rupees"], 0),
             r["status"], r["reasons"]]
    for j, v in enumerate(cells, start=2):
        ws.cell(row=rn, column=j, value=v)
    style_data_row(ws, row_num=rn, col_start=2, col_end=last_col, row_index=i)
    for c in (4, 5, 6, 7, 8):
        ws.cell(row=rn, column=c).number_format = "#,##0.00"
    ws.cell(row=rn, column=9).number_format = "+0.00;-0.00"
    ws.cell(row=rn, column=10).number_format = "+#,##0;-#,##0"
    ws.cell(row=rn, column=11).number_format = "#,##0"
    ws.cell(row=rn, column=12).number_format = "#,##0"
    # color P&L
    pnl_cell = ws.cell(row=rn, column=9)
    if r["pnl_pct"] > 0:
        pnl_cell.font = Font(name=FONT_NAME, size=11, color=ACCENT_POSITIVE, bold=True)
    elif r["pnl_pct"] < 0:
        pnl_cell.font = Font(name=FONT_NAME, size=11, color=ACCENT_NEGATIVE, bold=True)
    # color status
    status_cell = ws.cell(row=rn, column=13)
    color = status_colors.get(r["status"], NEUTRAL_600)
    status_cell.font = Font(name=FONT_NAME, size=11, color=color, bold=True)
    status_cell.alignment = Alignment(horizontal="center")

# totals row
tr = 5 + len(result)
ws.cell(row=tr, column=2, value="TOTAL")
ws.cell(row=tr, column=10, value=round(total_pnl, 0))
ws.cell(row=tr, column=12, value=round(total_invested, 0))
ws.cell(row=tr, column=13, value=f"{total_pnl/total_invested*100:+.2f}%")
style_total_row(ws, row_num=tr, col_start=2, col_end=last_col)
ws.cell(row=tr, column=10).number_format = "+#,##0;-#,##0"
ws.cell(row=tr, column=12).number_format = "#,##0"

auto_fit_columns(ws, min_width=10, max_width=40, header_row=4, data_start_row=5)
ws.column_dimensions["N"].width = 50  # reasons

# Sheet 2: Rules
ws2 = wb_out.create_sheet("Stop Rules")
ws2.sheet_view.showGridLines = False
rh = ["Rule", "Trigger", "Action", "Threshold"]
lc = len(rh) + 1
setup_sheet(ws2, title="Stop-Loss Rules", last_col=lc)
for i, h in enumerate(rh, start=2):
    ws2.cell(row=4, column=i, value=h)
style_header_row(ws2, row_num=4, col_start=2, col_end=lc)
rules = [
    ("1. Trend Break", "Close < 50 DMA", "EXIT", "Closing price below 50-day MA"),
    ("2. Hard Stop", "Price ≤ Entry × 0.92", "EXIT", "Fixed -8% loss cap from entry"),
    ("3. Trailing Stop", "Price ≤ Peak × 0.85", "EXIT", "Lock in 15% from peak gain"),
    ("4. Watch Zone", "Within 2% of any stop", "WATCH", "Reduce / tighten, prepare to exit"),
    ("5. Hold", "All stops > 2% away", "HOLD", "Healthy distance — keep position"),
]
for i, row in enumerate(rules):
    rn = 5 + i
    for j, v in enumerate(row, start=2):
        ws2.cell(row=rn, column=j, value=v)
    style_data_row(ws2, row_num=rn, col_start=2, col_end=lc, row_index=i)
auto_fit_columns(ws2, min_width=12, max_width=45, header_row=4, data_start_row=5)
ws2.column_dimensions["E"].width = 45

wb_out.properties.creator = "Z.ai"
wb_out.save(out_path)
print(f"\nExcel written: {out_path}")
