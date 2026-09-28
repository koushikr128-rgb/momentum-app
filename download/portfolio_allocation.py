"""
Portfolio Allocation Tool for Momentum Top-10
=============================================
Reads the latest screening Excel and computes a sensible ₹2 lakh allocation
using:
  - Base weight: inverse volatility (1 / ann_vol)  → risk parity
  - RSI penalty: dampen exposure to overbought names
      RSI > 80  → weight × 0.50   (RAYMOND 85.6)
      RSI 70-80 → weight × 0.75   (FILATEX 74.4, GMMPFAUDLR 77.4)
  - Position cap: 15% per stock
  - Sector cap: 25% per sector
  - Floor: 5% per stock
Caps/floors applied iteratively; excess weight redistributed to uncapped names.
"""
from __future__ import annotations

import os, sys, glob
from datetime import datetime

import numpy as np
import pandas as pd
from openpyxl import load_workbook

DOWNLOAD_DIR = "/home/z/my-project/download"
TOTAL_INVESTMENT = 200_000  # ₹2 lakh

# ---------------------------------------------------------------- find latest Excel
candidates = sorted(glob.glob(f"{DOWNLOAD_DIR}/nifty_momentum_screen_*.xlsx"))
if not candidates:
    print("No screen Excel found — run nifty_momentum_screen.py first.")
    sys.exit(1)
excel_path = candidates[-1]
print(f"Reading: {excel_path}")

# ---------------------------------------------------------------- read Top-10 sheet
wb = load_workbook(excel_path, data_only=True)
ws = wb["Top 10 Momentum Stocks"]

# Headers at row 4 (B=2...T=20). Data rows 5..14.
header_row = [ws.cell(row=4, column=c).value for c in range(2, 21)]
rows = []
for r in range(5, 15):
    row = [ws.cell(row=r, column=c).value for c in range(2, 21)]
    if row[0] is None:
        break
    rows.append(row)

df = pd.DataFrame(rows, columns=header_row)
print(f"\nLoaded {len(df)} positions. Columns: {list(df.columns)}\n")

# Clean numeric types
for c in df.columns:
    if c not in ("Symbol", "Company", "Sector"):
        df[c] = pd.to_numeric(df[c], errors="coerce")

# ---------------------------------------------------------------- allocation engine
def compute_allocation(df: pd.DataFrame,
                       total: float = TOTAL_INVESTMENT,
                       pos_cap: float = 0.15,
                       sector_cap: float = 0.25,
                       floor: float = 0.05) -> pd.DataFrame:
    """Inverse-vol weighting × RSI penalty, with position & sector caps."""
    d = df.copy()

    # 1) Base weight = inverse of annualized volatility
    vol = d["Ann Vol %"].fillna(d["Ann Vol %"].median())
    d["base_w"] = 1.0 / vol

    # 2) RSI penalty
    def rsi_mult(rsi):
        if pd.isna(rsi): return 1.0
        if rsi > 80: return 0.50  # severely overbought
        if rsi > 70: return 0.75  # approaching overbought
        return 1.0
    d["rsi_mult"] = d["RSI(14)"].apply(rsi_mult)
    d["adj_w"] = d["base_w"] * d["rsi_mult"]
    d["raw_w"] = d["adj_w"] / d["adj_w"].sum()

    # 3) Iteratively enforce floor / position cap / sector cap
    w = d["raw_w"].copy()
    for _ in range(20):
        # apply floor
        w = w.clip(lower=floor)
        # apply position cap
        over_pos = w > pos_cap
        w[over_pos] = pos_cap
        # apply sector cap (sum within sector)
        for sector, idx in d.groupby("Sector").groups.items():
            s = w[idx]
            if s.sum() > sector_cap:
                w[idx] = s * (sector_cap / s.sum())
        # renormalize the uncapped remainder
        w = w / w.sum()

    d["weight"] = w
    d["rupees"] = d["weight"] * total
    d["shares"] = (d["rupees"] / d["Price (₹)"]).apply(lambda x: int(round(x)))
    # round shares to nearest lot of 1 (NSE varies, keep simple)
    d["actual_rupees"] = d["shares"] * d["Price (₹)"]
    return d.sort_values("weight", ascending=False).reset_index(drop=True)


alloc = compute_allocation(df, total=TOTAL_INVESTMENT)

# ---------------------------------------------------------------- summary print
print("=" * 110)
print(f"PORTFOLIO ALLOCATION — ₹{TOTAL_INVESTMENT:,}  (computed {datetime.now():%Y-%m-%d %H:%M})")
print("=" * 110)
print(f"{'#':<3}{'Symbol':<12}{'Sector':<22}{'Price':>10}{'Weight%':>10}{'₹ Amount':>12}{'Shares':>8}  Notes")
print("-" * 110)
for i, r in alloc.iterrows():
    notes = []
    if r["RSI(14)"] > 80: notes.append("RSI>80 halved")
    elif r["RSI(14)"] > 70: notes.append("RSI>70 cut 25%")
    if r["Ann Vol %"] > 60: notes.append(f"High vol {r['Ann Vol %']:.1f}%")
    if r["weight"] >= 0.145: notes.append("capped@15%")
    note_str = ", ".join(notes)
    print(f"{i+1:<3}{r['Symbol']:<12}{r['Sector']:<22}{r['Price (₹)']:>10.2f}{r['weight']*100:>9.2f}%"
          f"{r['rupees']:>12,.0f}{r['shares']:>8}  {note_str}")

total_actual = alloc["actual_rupees"].sum()
print("-" * 110)
print(f"{'':<58}{'Total':>10}{total_actual:>12,.0f}  (cash leftover: ₹{TOTAL_INVESTMENT - total_actual:,.0f})")

# Sector breakdown
print("\n--- Sector Exposure ---")
sec = alloc.groupby("Sector")["weight"].agg(["sum", "count"]).sort_values("sum", ascending=False)
for sector, row in sec.iterrows():
    print(f"  {sector:<30} {row['sum']*100:>6.2f}%   ({int(row['count'])} stock{'s' if row['count']>1 else ''})")

# Risk metrics
print("\n--- Portfolio Risk Profile ---")
# weighted-average vol
wavg_vol = (alloc["weight"] * alloc["Ann Vol %"]).sum() / alloc["weight"].sum()
wavg_sharpe = (alloc["weight"] * alloc["Sharpe"]).sum() / alloc["weight"].sum()
wavg_6m = (alloc["weight"] * alloc["6M Ret %"]).sum() / alloc["weight"].sum()
wavg_rsi = (alloc["weight"] * alloc["RSI(14)"]).sum() / alloc["weight"].sum()
print(f"  Weighted-avg annualized vol : {wavg_vol:.2f}%")
print(f"  Weighted-avg Sharpe          : {wavg_sharpe:.2f}")
print(f"  Weighted-avg 6M return       : {wavg_6m:.2f}%")
print(f"  Weighted-avg RSI(14)         : {wavg_rsi:.1f}  (>{70} = portfolio running hot)")

# ---------------------------------------------------------------- write Excel sheet
out_path = f"{DOWNLOAD_DIR}/portfolio_allocation_{datetime.now():%Y-%m-%d}.xlsx"
from openpyxl import Workbook
sys.path.insert(0, "/home/z/my-project/skills/xlsx/templates")
from base import (FONT_NAME, HEADER_BOLD, PRIMARY, ACCENT_POSITIVE, ACCENT_NEGATIVE,
                  ACCENT_WARNING, NEUTRAL_600, setup_sheet, style_header_row,
                  style_data_row, style_total_row, auto_fit_columns)
from openpyxl.styles import Font, Alignment
from openpyxl.utils import get_column_letter

wb_out = Workbook()
ws = wb_out.active
ws.title = "Allocation"
ws.sheet_view.showGridLines = False

headers = ["#", "Symbol", "Sector", "Price (₹)", "Weight %", "₹ Amount",
           "Shares", "6M Ret %", "RSI(14)", "Ann Vol %", "Sharpe", "Notes"]
last_col = len(headers) + 1
title = f"Portfolio Allocation — ₹{TOTAL_INVESTMENT:,}  ({datetime.now():%Y-%m-%d})"
setup_sheet(ws, title=title, last_col=last_col)
for i, h in enumerate(headers, start=2):
    ws.cell(row=4, column=i, value=h)
style_header_row(ws, row_num=4, col_start=2, col_end=last_col)

for i, r in alloc.iterrows():
    rn = 5 + i
    notes = []
    if r["RSI(14)"] > 80: notes.append("RSI>80 halved")
    elif r["RSI(14)"] > 70: notes.append("RSI>70 −25%")
    if r["Ann Vol %"] > 60: notes.append("High vol")
    if r["weight"] >= 0.145: notes.append("capped@15%")
    cells = [i+1, r["Symbol"], r["Sector"], round(r["Price (₹)"], 2),
             round(r["weight"]*100, 2), round(r["rupees"], 0),
             int(r["shares"]), round(r["6M Ret %"], 2), round(r["RSI(14)"], 1),
             round(r["Ann Vol %"], 2), round(r["Sharpe"], 2), ", ".join(notes)]
    for j, v in enumerate(cells, start=2):
        ws.cell(row=rn, column=j, value=v)
    style_data_row(ws, row_num=rn, col_start=2, col_end=last_col, row_index=i)
    ws.cell(row=rn, column=5).number_format = "#,##0.00"
    ws.cell(row=rn, column=6).number_format = "0.00"
    ws.cell(row=rn, column=7).number_format = "#,##0"
    ws.cell(row=rn, column=8).number_format = "#,##0"
    ws.cell(row=rn, column=9).number_format = "0.00"
    ws.cell(row=rn, column=10).number_format = "0.0"
    ws.cell(row=rn, column=11).number_format = "0.00"
    ws.cell(row=rn, column=12).number_format = "0.00"
    # color RSI
    rsi_cell = ws.cell(row=rn, column=10)
    if r["RSI(14)"] > 80: rsi_cell.font = Font(name=FONT_NAME, size=11, color=ACCENT_NEGATIVE, bold=True)
    elif r["RSI(14)"] > 70: rsi_cell.font = Font(name=FONT_NAME, size=11, color=ACCENT_WARNING, bold=True)

# Totals row
tr = 5 + len(alloc)
ws.cell(row=tr, column=2, value="TOTAL")
ws.cell(row=tr, column=6, value=round(alloc["weight"].sum()*100, 2))
ws.cell(row=tr, column=7, value=round(alloc["rupees"].sum(), 0))
ws.cell(row=tr, column=8, value=round(alloc["actual_rupees"].sum(), 0))
ws.cell(row=tr, column=9, value=f"Cash left: ₹{TOTAL_INVESTMENT - alloc['actual_rupees'].sum():,.0f}")
style_total_row(ws, row_num=tr, col_start=2, col_end=last_col)
ws.merge_cells(start_row=tr, start_column=9, end_row=tr, end_column=last_col)
ws.cell(row=tr, column=9).alignment = Alignment(horizontal="left", vertical="center")

auto_fit_columns(ws, min_width=8, max_width=30, header_row=4, data_start_row=5)

# ---- Sheet 2: Sector summary ----
ws2 = wb_out.create_sheet("Sector Summary")
ws2.sheet_view.showGridLines = False
sh = ["Sector", "# Stocks", "Weight %", "₹ Allocated"]
lc2 = len(sh)+1
setup_sheet(ws2, title="Sector Diversification Check", last_col=lc2)
for i, h in enumerate(sh, start=2):
    ws2.cell(row=4, column=i, value=h)
style_header_row(ws2, row_num=4, col_start=2, col_end=lc2)
for i, (sector, row) in enumerate(sec.iterrows()):
    rn = 5 + i
    ws2.cell(row=rn, column=2, value=sector)
    ws2.cell(row=rn, column=3, value=int(row["count"]))
    ws2.cell(row=rn, column=4, value=round(row["sum"]*100, 2))
    ws2.cell(row=rn, column=5, value=round(row["sum"]*TOTAL_INVESTMENT, 0))
    style_data_row(ws2, row_num=rn, col_start=2, col_end=lc2, row_index=i)
    ws2.cell(row=rn, column=4).number_format = "0.00"
    ws2.cell(row=rn, column=5).number_format = "#,##0"
# sector total
tr2 = 5 + len(sec)
ws2.cell(row=tr2, column=2, value="TOTAL")
ws2.cell(row=tr2, column=3, value=int(sec["count"].sum()))
ws2.cell(row=tr2, column=4, value=round(sec["sum"].sum()*100, 2))
ws2.cell(row=tr2, column=5, value=round(sec["sum"].sum()*TOTAL_INVESTMENT, 0))
style_total_row(ws2, row_num=tr2, col_start=2, col_end=lc2)
auto_fit_columns(ws2, min_width=10, max_width=30, header_row=4, data_start_row=5)

# ---- Sheet 3: Methodology ----
ws3 = wb_out.create_sheet("Methodology")
ws3.sheet_view.showGridLines = False
mh = ["Step", "Rule", "Why"]
lc3 = len(mh)+1
setup_sheet(ws3, title="Allocation Methodology", last_col=lc3)
for i, h in enumerate(mh, start=2):
    ws3.cell(row=4, column=i, value=h)
style_header_row(ws3, row_num=4, col_start=2, col_end=lc3)
method = [
    ("1. Base", "Inverse volatility (1/Ann Vol %)", "Risk parity — equal risk contribution"),
    ("2. RSI penalty", "RSI > 80 → ×0.50, RSI 70-80 → ×0.75", "Trim overbought exposure"),
    ("3. Position cap", "Max 15% per stock", "Single-name risk control"),
    ("4. Sector cap", "Max 25% per sector", "Avoid sector concentration"),
    ("5. Floor", "Min 5% per stock", "Keep all 10 names in book"),
    ("6. Rebalance", "Iterative cap-and-renormalize", "Satisfy all constraints simultaneously"),
    ("7. Shares", "Round to nearest integer", "Practical execution"),
]
for i, row in enumerate(method):
    rn = 5 + i
    for j, v in enumerate(row, start=2):
        ws3.cell(row=rn, column=j, value=v)
    style_data_row(ws3, row_num=rn, col_start=2, col_end=lc3, row_index=i)
auto_fit_columns(ws3, min_width=10, max_width=45, header_row=4, data_start_row=5)
ws3.column_dimensions["D"].width = 45

# Risk profile block
rp_start = 5 + len(method) + 2
ws3.cell(row=rp_start, column=2, value="Portfolio Risk Profile").font = Font(name=FONT_NAME, size=12, bold=HEADER_BOLD, color=PRIMARY)
ws3.merge_cells(start_row=rp_start, start_column=2, end_row=rp_start, end_column=lc3)
risk_lines = [
    f"Weighted-avg annualized vol : {wavg_vol:.2f}%",
    f"Weighted-avg Sharpe          : {wavg_sharpe:.2f}",
    f"Weighted-avg 6M return       : {wavg_6m:.2f}%",
    f"Weighted-avg RSI(14)         : {wavg_rsi:.1f}",
]
for i, line in enumerate(risk_lines):
    c = ws3.cell(row=rp_start+1+i, column=2, value=line)
    c.font = Font(name=FONT_NAME, size=10, color=NEUTRAL_600)
    ws3.merge_cells(start_row=rp_start+1+i, start_column=2, end_row=rp_start+1+i, end_column=lc3)

wb_out.properties.creator = "Z.ai"
wb_out.save(out_path)
print(f"\nExcel written: {out_path}")
