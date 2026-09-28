"""
Stress Test — Portfolio Allocation for Momentum Top-10
======================================================
Reads the latest portfolio_allocation_*.xlsx and simulates 5 adverse
scenarios, computing per-stock and portfolio-level ₹ / % impact.

Scenarios:
  A. RSI Overbought Crash   — RSI>80 stocks -25%, RSI 70-80 -15%
  B. Sector Rotation        — Largest sector weight drops -20%
  C. Market Correction      — All stocks -10%
  D. Volatility Spike       — Ann vol >50% stocks -20%, others -8%
  E. Black Swan             — All stocks -25% (worst case)

Output: stress_test_<date>.xlsx with per-scenario breakdown + portfolio heatmap.
"""
from __future__ import annotations
import os, sys, glob
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import load_workbook

# Use download dir (where the allocation Excel lives)
DOWNLOAD_DIR = Path("/home/z/my-project/download")
SCRIPT_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------- find latest allocation Excel
candidates = sorted(DOWNLOAD_DIR.glob("portfolio_allocation_*.xlsx"))
if not candidates:
    print("No portfolio_allocation_*.xlsx found — run portfolio_allocation.py first.")
    sys.exit(1)
alloc_path = candidates[-1]
print(f"Reading allocation: {alloc_path.name}")

# ---------------------------------------------------------------- read allocation
wb = load_workbook(alloc_path, data_only=True)
ws = wb["Allocation"]
header_row = [ws.cell(row=4, column=c).value for c in range(2, 14)]  # B..M = 12 cols
rows = []
for r in range(5, 15):
    row = [ws.cell(row=r, column=c).value for c in range(2, 14)]
    if row[0] is None:
        break
    rows.append(row)

df = pd.DataFrame(rows, columns=header_row)
for c in df.columns:
    if c not in ("Symbol", "Sector", "Notes"):
        df[c] = pd.to_numeric(df[c], errors="coerce")

print(f"\nLoaded {len(df)} holdings.\n")

# rename for convenience
df = df.rename(columns={"Price (₹)": "price", "Weight %": "weight",
                         "₹ Amount": "rupees", "Shares": "shares",
                         "6M Ret %": "ret_6m", "RSI(14)": "rsi",
                         "Ann Vol %": "ann_vol", "Sharpe": "sharpe"})

# also fetch total invested from row 15 (TOTAL row)
total_invested = float(ws.cell(row=15, column=7).value or 200000)
print(f"Total invested: ₹{total_invested:,.0f}")

# ---------------------------------------------------------------- scenarios
scenarios = []

# A. RSI Overbought Crash
def rsi_drop(rsi):
    if pd.isna(rsi): return 0.0
    if rsi > 80: return -0.25
    if rsi > 70: return -0.15
    return 0.0
df_A = df.copy()
df_A["shock_pct"] = df_A["rsi"].apply(rsi_drop)
scenarios.append(("A. RSI Overbought Crash",
                  "RSI>80 stocks drop 25%, RSI 70-80 drop 15%",
                  df_A))

# B. Sector Rotation — largest sector -20%
sec_weights = df.groupby("Sector")["weight"].sum()
biggest_sector = sec_weights.idxmax()
df_B = df.copy()
df_B["shock_pct"] = np.where(df_B["Sector"] == biggest_sector, -0.20, 0.0)
scenarios.append(("B. Sector Rotation",
                  f"Largest sector ({biggest_sector}, {sec_weights[biggest_sector]:.1f}%) drops 20%",
                  df_B))

# C. Market Correction — all -10%
df_C = df.copy()
df_C["shock_pct"] = -0.10
scenarios.append(("C. Market Correction",
                  "All stocks drop 10%",
                  df_C))

# D. Volatility Spike — high-vol (>50%) -20%, others -8%
df_D = df.copy()
df_D["shock_pct"] = np.where(df_D["ann_vol"] > 50, -0.20, -0.08)
scenarios.append(("D. Volatility Spike",
                  "High-vol (>50% ann vol) stocks drop 20%, others drop 8%",
                  df_D))

# E. Black Swan — all -25%
df_E = df.copy()
df_E["shock_pct"] = -0.25
scenarios.append(("E. Black Swan",
                  "All stocks drop 25% (worst case)",
                  df_E))

# ---------------------------------------------------------------- compute impact
results = []
for name, desc, d in scenarios:
    d = d.copy()
    d["rupee_loss"] = d["rupees"] * d["shock_pct"]
    d["new_value"] = d["rupees"] + d["rupee_loss"]
    total_loss = d["rupee_loss"].sum()
    new_portfolio = d["new_value"].sum()
    drawdown_pct = total_loss / total_invested * 100
    worst_stock = d.loc[d["rupee_loss"].idxmin()]
    results.append({
        "scenario": name,
        "description": desc,
        "total_loss": total_loss,
        "new_value": new_portfolio,
        "drawdown_pct": drawdown_pct,
        "worst_stock_symbol": worst_stock["Symbol"],
        "worst_stock_loss": worst_stock["rupee_loss"],
        "stocks_hit": int((d["shock_pct"] < 0).sum()),
        "detail_df": d,
    })

# ---------------------------------------------------------------- print summary
print("=" * 100)
print(f"STRESS TEST REPORT — Portfolio ₹{total_invested:,.0f}  ({datetime.now():%Y-%m-%d %H:%M})")
print("=" * 100)
print(f"{'Scenario':<30}{'# Hit':>7}{'₹ Loss':>14}{'New Value':>14}{'Drawdown':>11}{'Worst Stock':>15}")
print("-" * 100)
for r in results:
    print(f"{r['scenario']:<30}{r['stocks_hit']:>7}"
          f"{r['total_loss']:>14,.0f}{r['new_value']:>14,.0f}"
          f"{r['drawdown_pct']:>10.2f}%"
          f"  {r['worst_stock_symbol']} (₹{r['worst_stock_loss']:,.0f})")

print("\n--- Portfolio Resilience ---")
worst_dd = max(r["drawdown_pct"] for r in results)
best_dd = min(r["drawdown_pct"] for r in results)
print(f"  Worst-case drawdown : {worst_dd:.2f}%  (₹{total_invested * worst_dd/100:,.0f} loss)")
print(f"  Mildest drawdown     : {best_dd:.2f}%  (₹{total_invested * best_dd/100:,.0f} loss)")
print(f"  Cash buffer needed to survive worst case: ₹{total_invested * worst_dd/100:,.0f}")

# ---------------------------------------------------------------- write Excel
out_path = DOWNLOAD_DIR / f"stress_test_{datetime.now():%Y-%m-%d}.xlsx"
from openpyxl import Workbook
sys.path.insert(0, "/home/z/my-project/skills/xlsx/templates")
from base import (FONT_NAME, HEADER_BOLD, PRIMARY, ACCENT_POSITIVE, ACCENT_NEGATIVE,
                  ACCENT_WARNING, NEUTRAL_600, NEUTRAL_900,
                  setup_sheet, style_header_row, style_data_row, style_total_row,
                  auto_fit_columns)
from openpyxl.styles import Font, PatternFill, Alignment

wb_out = Workbook()

# Sheet 1: Summary
ws = wb_out.active
ws.title = "Stress Summary"
ws.sheet_view.showGridLines = False
headers = ["Scenario", "Description", "# Stocks Hit", "Total ₹ Loss",
           "New Portfolio ₹", "Drawdown %", "Worst Stock", "Worst Stock ₹ Loss"]
last_col = len(headers) + 1
setup_sheet(ws, title=f"Stress Test Summary — Portfolio ₹{total_invested:,.0f}",
            last_col=last_col)
for i, h in enumerate(headers, start=2):
    ws.cell(row=4, column=i, value=h)
style_header_row(ws, row_num=4, col_start=2, col_end=last_col)

for i, r in enumerate(results):
    rn = 5 + i
    cells = [r["scenario"], r["description"], r["stocks_hit"],
             round(r["total_loss"], 0), round(r["new_value"], 0),
             round(r["drawdown_pct"], 2),
             r["worst_stock_symbol"], round(r["worst_stock_loss"], 0)]
    for j, v in enumerate(cells, start=2):
        ws.cell(row=rn, column=j, value=v)
    style_data_row(ws, row_num=rn, col_start=2, col_end=last_col, row_index=i)
    ws.cell(row=rn, column=5).number_format = "#,##0"
    ws.cell(row=rn, column=6).number_format = "#,##0"
    ws.cell(row=rn, column=7).number_format = "#,##0"
    ws.cell(row=rn, column=8).number_format = "0.00"
    ws.cell(row=rn, column=10).number_format = "#,##0"
    # color drawdown
    dd_cell = ws.cell(row=rn, column=8)
    if r["drawdown_pct"] > 15:
        dd_cell.font = Font(name=FONT_NAME, size=11, color=ACCENT_NEGATIVE, bold=True)
    elif r["drawdown_pct"] > 10:
        dd_cell.font = Font(name=FONT_NAME, size=11, color=ACCENT_WARNING, bold=True)
auto_fit_columns(ws, min_width=10, max_width=40, header_row=4, data_start_row=5)
ws.column_dimensions["C"].width = 50

# Sheets 2..6: per-scenario detail
for r in results:
    sheet_name = r["scenario"][:31]  # Excel sheet name limit
    ws_d = wb_out.create_sheet(sheet_name)
    ws_d.sheet_view.showGridLines = False
    dh = ["Symbol", "Sector", "Weight %", "₹ Allocated", "Shares",
          "RSI(14)", "Ann Vol %", "Shock %", "₹ Loss", "New Value"]
    lc = len(dh) + 1
    setup_sheet(ws_d, title=f"{r['scenario']} — {r['description']}", last_col=lc)
    for i, h in enumerate(dh, start=2):
        ws_d.cell(row=4, column=i, value=h)
    style_header_row(ws_d, row_num=4, col_start=2, col_end=lc)
    for i, (_, row) in enumerate(r["detail_df"].iterrows()):
        rn = 5 + i
        cells = [row["Symbol"], row["Sector"], round(row["weight"], 2),
                round(row["rupees"], 0), int(row["shares"]),
                round(row["rsi"], 1), round(row["ann_vol"], 2),
                round(row["shock_pct"]*100, 2),
                round(row["rupee_loss"], 0), round(row["new_value"], 0)]
        for j, v in enumerate(cells, start=2):
            ws_d.cell(row=rn, column=j, value=v)
        style_data_row(ws_d, row_num=rn, col_start=2, col_end=lc, row_index=i)
        ws_d.cell(row=rn, column=4).number_format = "0.00"
        ws_d.cell(row=rn, column=5).number_format = "#,##0"
        ws_d.cell(row=rn, column=6).number_format = "#,##0"
        ws_d.cell(row=rn, column=7).number_format = "0.0"
        ws_d.cell(row=rn, column=8).number_format = "0.00"
        ws_d.cell(row=rn, column=9).number_format = "0.00"
        ws_d.cell(row=rn, column=10).number_format = "#,##0"
        ws_d.cell(row=rn, column=11).number_format = "#,##0"
        # color shock
        shock_cell = ws_d.cell(row=rn, column=9)
        if row["shock_pct"] < -0.15:
            shock_cell.font = Font(name=FONT_NAME, size=11, color=ACCENT_NEGATIVE, bold=True)
        elif row["shock_pct"] < 0:
            shock_cell.font = Font(name=FONT_NAME, size=11, color=ACCENT_WARNING)
    # totals row
    tr = 5 + len(r["detail_df"])
    ws_d.cell(row=tr, column=2, value="TOTAL")
    ws_d.cell(row=tr, column=5, value=round(r["detail_df"]["rupees"].sum(), 0))
    ws_d.cell(row=tr, column=10, value=round(r["total_loss"], 0))
    ws_d.cell(row=tr, column=11, value=round(r["new_value"], 0))
    style_total_row(ws_d, row_num=tr, col_start=2, col_end=lc)
    ws_d.cell(row=tr, column=5).number_format = "#,##0"
    ws_d.cell(row=tr, column=10).number_format = "#,##0"
    ws_d.cell(row=tr, column=11).number_format = "#,##0"
    auto_fit_columns(ws_d, min_width=10, max_width=25, header_row=4, data_start_row=5)

wb_out.properties.creator = "Z.ai"
wb_out.save(out_path)
print(f"\nExcel written: {out_path}")
