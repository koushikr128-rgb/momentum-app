"""
Nifty Total Market — Momentum Strategy Screener
================================================
Rules:
  - Current Price > 200 DMA
  - Current Price > 50 DMA
  - 50 DMA > 200 DMA
  - RSI(14) > 55
  - Market Cap > ₹500 Cr
  - Avg Daily Volume (30D) > 50,000
  - Order by 6-Month Price Return % DESC

Re-runnable: each run pulls latest data and writes a fresh Excel file to
/home/z/my-project/download/nifty_momentum_screen_YYYY-MM-DD.xlsx
"""
from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd
import yfinance as yf

# ------------------------------------------------------------------ config
LOG_PATH = "/home/z/my-project/scripts/screen.log"
DOWNLOAD_DIR = "/home/z/my-project/download"
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(LOG_PATH, mode="w"), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("screen")

# Universe: a comprehensive list of NSE-listed stocks covering the bulk of the
# Nifty Total Market index (large + mid + a sample of small caps).
NIFTY_UNIVERSE = [
    # --- Aditya Birla group ---
    "ABFRL", "ABREL", "ADANIENT", "ADANIPORTS", "ATGL", "AWL",
    # --- Auto & ancillary ---
    "ASHOKLEY", "BALKRISIND", "BOSCHLTD", "BHEL", "EICHERMOT", "EXIDEIND",
    "MRF", "MOTHERSON", "MOHITIND", "BALKRISIND", "BHARATFORG", "TATAELXSI",
    "TIINDIA", "ENDURANCE", "MINDACORP", "OLECTRA",
    # --- Banks & NBFC ---
    "SBIN", "HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "INDUSINDBK",
    "PNB", "BANKBARODA", "CANBK", "IDFCFIRSTB", "FEDERALBNK", "AUBANK",
    "BANDHANBNK", "SBICARD", "JINDALSAW", "LICHSGFIN", "PFC", "RECLTD",
    "MUTHOOTFIN", "CHOLAFIN", "BAJFINANCE", "BAJAJFINSV", "BAJAJHLDNG",
    "SHRIRAMFIN", "MAHSCFIN", "IIFL", "LTF", "MANAPPURAM",
    # --- BFSI others ---
    "HDFCLIFE", "SBILIFE", "ICICIPRULI", "ICICIGI", "NIACL", "STARHEALTH",
    # --- Cement ---
    "ULTRACEMCO", "SHREECEM", "AMBUJACEM", "ACC", "GRASIM", "RAMCOCEM",
    "DALBHARAT", "JKCEMENT", "PRIYA", "HEIDELBERG", "MANGALAM",
    # --- Chemicals & Specialty ---
    "PIDILITIND", "SRF", "TATACHEM", "AARTIIND", "PIIND", "ATALEENTER",
    "LINDEINDIA", "NAVINFLUOR", "FLUOROCHEM", "TANLA", "ATUL", "BHARATRAS",
    "DEEPAKNTR", "CHAMBLFERT", "COROMANDEL", "FACT", "GMMPFAUDLR",
    "FINEORG", "CHEMPLAST", "AMBER", "KAYNES",
    # --- Consumer / FMCG ---
    "HINDUNILVR", "NESTLEIND", "ITC", "BRITANNIA", "DABUR", "GODREJCP",
    "MARICO", "TATACONSUM", "COLPAL", "EMAMILTD", "PGHH", "VSTIND",
    "RADICO", "United-SPIRITS", "MCDOWELL-N", "TILAKNEG", "HATSUN", "KRBL",
    # --- Energy / Oil & Gas / Power ---
    "RELIANCE", "ONGC", "NTPC", "POWERGRID", "IOC", "BPCL", "HINDPETRO",
    "GAIL", "COALINDIA", "TATAPOWER", "ADANIPOWER", "THERMAX", "BHEL",
    "NHPC", "SJVN", "SUZLON", "INVERTERS", "KEI", "APTECHT",
    "JSWENERGY", "PRESTIGE", "CESC", "IGL", "MGL", "GUJGASLTD",
    # --- Financial services / Index / BPS ---
    "HDFCAMC", "NAM-INDIA", "UTIAMC", "ABCAPITAL", "SBICARD",
    # --- Healthcare / Pharma ---
    "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "LUPIN", "AUROPHARMA",
    "BIOCON", "TORNTPHARM", "ALKEM", "ABBOTINDIA", "IPCALAB",
    "LAOPALA", "SYNGENE", "MAXHEALTH", "POLYMED", "LAURUSLABS", "JBCHEPHARM",
    "CAPLI", "FORTIS", "GLENMARK", "WOCKPHARMA", "HINDMOTORS",
    # --- IT / Tech ---
    "TCS", "INFY", "WIPRO", "HCLTECH", "TECHM", "LTIM", "PERSISTENT",
    "COFORGE", "MPHASIS", "OFSS", "TATAELXSI", "BSOFT", "LTTS",
    "KAYNES", "SASKEN", "KERNEX", "INTELLECT", "ECLERX", "SONATCS",
    # --- Infrastructure / Construction / Engineering ---
    "LT", "ULTRACEMCO", "ABB", "SIEMENS", "BHEL", "CUMMINSIND", "CGPOWER",
    "EPIQ", "EASEMYTRIP", "ENIL", "SUPREMEIND", "PNCINFRA", "KNRCON",
    "HUDCO", "IRB", "DONEAR", "PHOENIXLTD", " Brigade", "BRIGADE",
    "PRESTIGE", "GODREJPROP", "OBEROIRLTY", "DLF", "LODHA", "MACMILLAN",
    "KOLTE", "MAHINDRA", "ANANTRAJ", "SUNTECK",
    # --- Metals & Mining ---
    "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "JINDALSTEL", "SAIL",
    "NMDC", "NATIONALUM", "APLAPOLLO", "JSL", "RATNAMANI", "MAHASTEEL",
    "WELCORP", "HINDZINC", "JSPL",
    # --- Media / Telecom ---
    "BHARTIARTL", "IDEA", "INDUS TOWER", "INDUSTOWER", "TATAELXSI",
    "SUNTV", "TIPSIND", "NETWORK18", "TVTODAY", "PVRINOX", "INOXLEISUR",
    "ZEEL", "DEN",
    # --- Realty ---
    "DLF", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "LODHA", "BRIGADE",
    "PHOENIXLTD", "SOBHA", "MAHINDRA", "SUNTECK", "ANANTRAJ", "KOLTE",
    # --- Retail / Services / Other ---
    "TRENT", "DMART", "VEDL", "TITAN", "JUBLFOOD", "INDHOTEL",
    "EASEMYTRIP", "INDIGO", "EIHOTEL", "ASIANPAINT", "BERGERPAINT",
    "AKZOIND", "HAVELLS", "BAJAJELEC", "VOLTAS", "BLUESTAR",
    "CROMPTON", "POLYCAB", "HAVELLS", "KEI", "FINCABLES", "FINPIPE",
    "KSB", "NATURALCAPS", "WHIRLPOOL", "TTKPRESTIG", "STOVE",
    "HONAUT", "TATACOMM", "BHARTIHEX", "IDEA", "BANDHANBNK",
    # --- Bajaj group ---
    "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BAJAJHLDNG",
    # --- Mahindra group ---
    "M&M", "M&MFIN", "MAHINDRA", "MAHSCFIN",
    # --- Tata group (others) ---
    "TATAMOTORS", "TATASTEEL", "TATAPOWER", "TATACONSUM", "TATACHEM",
    "TATAINVEST", "TATACOFFEE", "TATAELXSI", "TRENT", "TIINDIA",
    # --- Watch list extras (small/mid caps that often screen high momentum) ---
    "CDSL", "CAMSONLINE", "CAMS", "MCX", "IEX", "TEJASNET",
    "MAZDOCK", "Cochin-SHIP", "COCHINSHIP", "HAL", "BEL", "BDL",
    "ASTRAL", "PRINCEPIPE", "SUPREMEIND", "FINOLEX", "FINPIPE",
    "MASTEK", "TARSONS", "KIRLOSKAR", "KSB", "EPIQ",
    "TANLA", "ROUTE", "INDIAMART", "NYKAA", "FSL", "ECLERX",
    "ZOMATO", "PAYTM", "POLICYBZR", "NAUKRI", "INDIAMART",
    "DELHIVERY", "HAPPY", "CONCOR", "TCI", "TCIEXP", "BLUEJET",
    "ANGELONE", "ICICISEC", "IIFLSEC", "MOTILALOFS", "UTIASSET",
    # --- Pharma / Specialty extra ---
    "SUZLON", "RAYMOND", "RAYMONDLSL", "GICRE", "BERGERPAINT",
    "CUB", "RECLTD", "IREDI",
    "VIPIND", "MINDACORP", "TALBROAUTO", "BATAINDIA", "FILATEX",
    "TIMKEN", "SKFINDIA", "SCHNEIDER", "SCHAEFFLER",
    "MFSL", "HDFCAMC", "NAM-INDIA",
    "AMBUJACEM", "ACE", "ACRYSIL", "AETHER", "AREVA", "ASAHIINDIA",
    "AREAL", "CLASSIC", "CLEAN", "CLED", "DCAL", "EASEMYTRIP",
    # --- Telecom + IT services extras ---
    "HCLTECH", "WIPRO", "MPHASIS", "OFSS", "TATAELXSI", "PERSISTENT",
    # --- Agri / Sugar / Tea ---
    "BALAMLIPRI", "EIDPARRY", "BANNARI", "DHAMPUR", "TRIVENI", "SHREEENU",
    "SHREE RENUKA", "MAGADSUGAR", "DWARKESH", "DHAMPURSUGAR",
    # --- Logistics / Shipping ---
    "CONCOR", "DELHIVERY", "BLUEJET", "TCI", "TCIEXP", "MAZDOCK",
    "GESHIP", "SHREYAS", "ABGSHIP",
    # --- Packaged consumer / Beverages ---
    "VBL", "PGHH", "COLPAL", "GODREJCP", "MARICO", "DABUR", "HINDUNILVR",
    "EMAMILTD", "TATACONSUM",
    # --- Quick commerce / New age ---
    "ZOMATO", "PAYTM", "NAUKRI", "POLICYBZR", "NYKAA", "DELHIVERY",
    # --- More midcaps covering Nifty 500 breadth ---
    "AARTIIND", "AARTIDRUGS", "AARTIPHARM", "ANKITMETAL", "ANUP",
    "APARINDS", "APLLTD", "APOLLO", "APOLLOTYRE", "ARVINDFSL",
    "ASIANPAINT", "ASTERDM", "ASTRAL", "ATUL", "AUBANK", "AUROPHARMA",
    "AVAILITY", "AWL", "BAJAJ-AUTO", "BAJAJELEC", "BAJFINANCE", "BAJAJFINSV",
    "BAJAJHLDNG", "BALKRISIND", "BALRAMCHIN", "BANDHANBNK", "BANKBARODA",
    "BANKINDIA", "BATAINDIA", "BEL", "BERGERPAINT", "BHARATFORG", "BHEL",
    "BIOCON", "BIRLACORPN", "BSOFT", "CANBK", "CHAMBLFERT", "CHOLAFIN",
    "CIPLA", "CLEAN", "COALINDIA", "COFORGE", "COLPAL", "CONCOR",
    "COROMANDEL", "CROMPTON", "CUB", "CUMMINSIND", "DABUR", "DALBHARAT",
    "DEEPAKNTR", "DELHIVERY", "DIVISLAB", "DLF", "DRREDDY", "ECLERX",
    "EICHERMOT", "EIHOTEL", "EPIQ", "EQUITASBNK", "EXIDEIND", "FEDERALBNK",
    "FINCABLES", "FINPIPE", "FSL", "GAIL", "GEPIL", "GHCL", "GICRE",
    "GMRINFRA", "GODREJCP", "GODREJPROP", "GRANULES", "GRASIM", "GSFC",
    "GUJGASLTD", "HAL", "HAVELLS", "HCLTECH", "HDFCAMC", "HDFCBANK",
    "HDFCLIFE", "HDFCLIFE", "HEIDELBERG", "HEROMOTOCO", "HINDALCO", "HINDPETRO",
    "HINDUNILVR", "HINDZINC", "HONAUT", "HUDCO", "ICICIBANK", "ICICIGI",
    "ICICIPRULI", "ICICISEC", "IEX", "IGL", "INDHOTEL", "INDIGO",
    "INDIAMART", "INDUSINDBK", "INDUSTOWER", "INFY", "INOXLEISUR", "INOXWIND",
    "IOLCP", "IPCALAB", "IRB", "IRCTC", "ITC", "JBCHEPHARM", "JINDALSTEL",
    "JSPL", "JSWENERGY", "JSWSTEEL", "JUBLFOOD", "JYOTHYLAB", "KEI",
    "KOTAKBANK", "KSCL", "LALPATHLAB", "LAOPALA", "LAURUSLABS", "LICHSGFIN",
    "LINDEINDIA", "LT", "LTIM", "LTTS", "LUPIN", "M&M", "M&MFIN",
    "MANAPPURAM", "MARICO", "MCDOWELL-N", "MCX", "METROPOLISHEALTH", "MFSL",
    "MGL", "MINDACORP", "MOTHERSON", "MPHASIS", "MRF", "MUTHOOTFIN",
    "NAM-INDIA", "NAUKRI", "NATIONALUM", "NAVINFLUOR", "NESTLEIND", "NMDC",
    "NTPC", "OLECTRA", "OFSS", "OILCORP", "ONGC", "PAGEIND", "PATANJALI",
    "PAYTM", "PERSISTENT", "PGHH", "PIDILITIND", "PIIND", "PNB", "POLICYBZR",
    "POLYCAB", "POWERGRID", "PFC", "PRESTIGE", "PVRINOX", "RAMCOCEM",
    "RATNAMANI", "RAYMOND", "RBLBANK", "RECLTD", "RELIANCE", "ROUTE",
    "SAIL", "SBICARD", "SBILIFE", "SBIN", "SCHAEFFLER", "SHREECEM",
    "SHRIRAMFIN", "SIEMENS", "SJVN", "SKFINDIA", "SONATCS", "STARHEALTH",
    "SUNPHARMA", "SUNTV", "SUPREMEIND", "SUZLON", "SYNGENE", "TANLA",
    "TATACHEM", "TATACOFFEE", "TATACONSUM", "TATAELXSI", "TATAINVEST",
    "TATAMOTORS", "TATAPOWER", "TATASTEEL", "TCI", "TCIEXP", "TCS",
    "TECHM", "TIINDIA", "TIPSIND", "TITAN", "TORNTPHARM", "TRENT",
    "TTKPRESTIG", "TVSMOTOR", "TVTODAY", "UBL", "UCOBANK", "ULTRACEMCO",
    "UNIONBANK", "UNITDSPR", "UPL", "VBL", "VEDL", "VOLTAS", "VSTIND",
    "WELCORP", "WHIRLPOOL", "WIPRO", "ZOMATO", "ZYDUSLIFE",
    # Adani group
    "ADANIENT", "ADANIPORTS", "ATGL", "AWL",
]

# de-duplicate while preserving order
def _dedupe(seq):
    seen = set(); out = []
    for x in seq:
        if x and x not in seen:
            seen.add(x); out.append(x)
    return out

UNIVERSE = _dedupe(NIFTY_UNIVERSE)
log.info("Universe size: %d unique NSE symbols", len(UNIVERSE))


# ------------------------------------------------------------------ indicators
def compute_indicators(prices: pd.DataFrame) -> Optional[dict]:
    """Compute all per-stock metrics from a daily OHLCV DataFrame.

    Expects columns: Open, High, Low, Close, Volume (single stock).
    Returns None if not enough history for 200 DMA.
    """
    if prices is None or len(prices) < 220:
        return None
    if prices["Close"].dropna().shape[0] < 220:
        return None

    close = prices["Close"].dropna()
    volume = prices["Volume"].dropna()
    if len(close) < 220 or len(volume) < 30:
        return None

    current_price = float(close.iloc[-1])
    if not np.isfinite(current_price) or current_price <= 0:
        return None

    dma_50 = float(close.tail(50).mean())
    dma_200 = float(close.tail(200).mean())
    if not (np.isfinite(dma_50) and np.isfinite(dma_200)):
        return None

    # RSI(14) — Wilder's smoothing
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1.0 / 14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / 14, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    rsi_14 = float(rsi.iloc[-1])
    if not np.isfinite(rsi_14):
        rsi_14 = 50.0  # neutral fallback

    # Volume — average of last 30 trading days
    avg_volume_30d = float(volume.tail(30).mean())

    # Returns — use ~21 trading days for 1M, ~63 for 3M, ~126 for 6M
    def ret(n):
        if len(close) <= n:
            return np.nan
        prev = float(close.iloc[-1 - n])
        if prev <= 0:
            return np.nan
        return (current_price / prev - 1.0) * 100.0

    ret_1m = ret(21)
    ret_3m = ret(63)
    ret_6m = ret(126)

    # Annualized volatility & Sharpe (daily returns, last 126 days ≈ 6M)
    daily_ret = close.pct_change().dropna().tail(126)
    if len(daily_ret) > 20:
        vol_daily = float(daily_ret.std(ddof=1))
        ann_vol = vol_daily * np.sqrt(252.0) * 100.0  # in %
        mean_daily = float(daily_ret.mean())
        if vol_daily > 0:
            sharpe = (mean_daily / vol_daily) * np.sqrt(252.0)
        else:
            sharpe = 0.0
    else:
        ann_vol = np.nan
        sharpe = np.nan

    # 52-week high / low
    window_52w = close.tail(252) if len(close) >= 252 else close
    high_52w = float(window_52w.max())
    low_52w = float(window_52w.min())
    pct_below_high = (current_price / high_52w - 1.0) * 100.0 if high_52w > 0 else np.nan
    pct_above_low = (current_price / low_52w - 1.0) * 100.0 if low_52w > 0 else np.nan
    pct_above_200dma = (current_price / dma_200 - 1.0) * 100.0 if dma_200 > 0 else np.nan

    last_date = close.index[-1]

    return {
        "last_date": last_date,
        "current_price": current_price,
        "dma_50": dma_50,
        "dma_200": dma_200,
        "rsi_14": rsi_14,
        "avg_volume_30d": avg_volume_30d,
        "ret_1m_pct": ret_1m,
        "ret_3m_pct": ret_3m,
        "ret_6m_pct": ret_6m,
        "ann_vol_pct": ann_vol,
        "sharpe": sharpe,
        "high_52w": high_52w,
        "low_52w": low_52w,
        "pct_below_high": pct_below_high,
        "pct_above_low": pct_above_low,
        "pct_above_200dma": pct_above_200dma,
    }


# ------------------------------------------------------------------ download
def batch_download(tickers: list[str], period: str = "18mo") -> pd.DataFrame:
    """Robust batch download with retries (handles yfinance 'database locked')."""
    tickers_ns = [f"{s}.NS" for s in tickers]
    last_err = None
    for attempt in range(3):
        try:
            data = yf.download(
                tickers_ns,
                period=period,
                group_by="ticker",
                threads=True,
                progress=False,
                auto_adjust=False,
            )
            return data
        except Exception as e:
            last_err = e
            log.warning("Download attempt %d failed: %s", attempt + 1, e)
            time.sleep(2.0)
    raise RuntimeError(f"All download attempts failed: {last_err}")


def fetch_info_batch(tickers_ns: list[str], max_retries: int = 2) -> dict:
    """Fetch marketCap + sector + industry via .info (slow but works for NSE).
    Returns dict ticker -> {market_cap, sector, industry, long_name}.
    """
    out = {}
    for i, tk in enumerate(tickers_ns):
        for attempt in range(max_retries):
            try:
                t = yf.Ticker(tk)
                info = t.info or {}
                mc = info.get("marketCap")
                out[tk] = {
                    "market_cap": mc,
                    "sector": info.get("sector") or "—",
                    "industry": info.get("industry") or "—",
                    "long_name": info.get("longName") or info.get("shortName") or tk,
                }
                break
            except Exception as e:
                if attempt == max_retries - 1:
                    out[tk] = {"market_cap": None, "sector": "—",
                               "industry": "—", "long_name": tk}
                    log.warning("info failed for %s: %s", tk, e)
                else:
                    time.sleep(0.5)
        if i % 20 == 0 and i > 0:
            log.info("  info progress: %d/%d", i, len(tickers_ns))
    return out


# ------------------------------------------------------------------ main
def main():
    started = datetime.now()
    log.info("=== Nifty Momentum Screen started at %s ===", started.isoformat(timespec="seconds"))

    # 1) Batch download OHLCV
    log.info("Downloading ~18 months of daily OHLCV for %d NSE stocks...", len(UNIVERSE))
    raw = batch_download(UNIVERSE, period="18mo")
    log.info("Downloaded. DataFrame shape: %s", getattr(raw, "shape", None))

    # 2) Compute indicators per stock
    rows = []
    skipped = 0
    for sym in UNIVERSE:
        col = f"{sym}.NS"
        try:
            if isinstance(raw.columns, pd.MultiIndex):
                if col not in raw.columns.get_level_values(0):
                    # symbol may not be present
                    skipped += 1
                    continue
                df = raw[col].dropna(subset=["Close"])
            else:
                # single ticker case — flat columns
                df = raw.dropna(subset=["Close"])
        except Exception as e:
            log.debug("skip %s: %s", sym, e)
            skipped += 1
            continue

        metrics = compute_indicators(df)
        if metrics is None:
            skipped += 1
            continue
        metrics["symbol"] = sym
        metrics["ticker"] = col
        rows.append(metrics)

    log.info("Indicators computed for %d stocks (%d skipped due to insufficient data)",
             len(rows), skipped)

    if not rows:
        log.error("No usable data — aborting.")
        return 1

    df = pd.DataFrame(rows)

    # 3) Apply technical + volume filters FIRST (cheap; no .info needed)
    pre = len(df)
    mask = (
        (df["current_price"] > df["dma_200"]) &
        (df["current_price"] > df["dma_50"]) &
        (df["dma_50"] > df["dma_200"]) &
        (df["rsi_14"] > 55) &
        (df["avg_volume_30d"] > 50_000) &
        df["ret_6m_pct"].notna()
    )
    df_filt = df[mask].copy()
    log.info("After technical+volume filter: %d / %d stocks pass", len(df_filt), pre)

    if df_filt.empty:
        log.warning("No stocks pass technical filter — writing empty workbook for traceability.")
        df_filt["market_cap_cr"] = []
    else:
        # 4) Fetch market cap + sector for the filtered set only (efficient)
        log.info("Fetching market cap + sector for %d stocks via .info...", len(df_filt))
        info_map = fetch_info_batch(df_filt["ticker"].tolist())
        df_filt["market_cap"] = df_filt["ticker"].map(lambda t: info_map.get(t, {}).get("market_cap"))
        df_filt["sector"] = df_filt["ticker"].map(lambda t: info_map.get(t, {}).get("sector", "—"))
        df_filt["industry"] = df_filt["ticker"].map(lambda t: info_map.get(t, {}).get("industry", "—"))
        df_filt["long_name"] = df_filt["ticker"].map(lambda t: info_map.get(t, {}).get("long_name", ""))

        # Convert market cap to ₹ Cr (1 Cr = 10,000,000 INR)
        df_filt["market_cap_cr"] = df_filt["market_cap"].astype(float) / 1e7

        # 5) Apply market cap filter
        pre_mc = len(df_filt)
        df_filt = df_filt[df_filt["market_cap_cr"] > 500.0].copy()
        log.info("After market-cap filter (>500 Cr): %d / %d stocks pass", len(df_filt), pre_mc)

    # 6) Sort by 6M return DESC and take top 10
    df_filt = df_filt.sort_values("ret_6m_pct", ascending=False).head(10).reset_index(drop=True)
    df_filt.insert(0, "rank", range(1, len(df_filt) + 1))

    log.info("Final Top 10 stocks:")
    if not df_filt.empty:
        for _, r in df_filt.iterrows():
            log.info("  #%d %s — 6M ret=%.2f%%  RSI=%.1f  MCap=₹%.0fCr",
                     r["rank"], r["symbol"], r["ret_6m_pct"], r["rsi_14"], r["market_cap_cr"])

    # 7) Build Excel
    today_str = datetime.now().strftime("%Y-%m-%d")
    out_path = os.path.join(DOWNLOAD_DIR, f"nifty_momentum_screen_{today_str}.xlsx")
    build_excel(df_filt, out_path, started=started)
    log.info("Excel written: %s", out_path)
    log.info("Total elapsed: %.1f s", (datetime.now() - started).total_seconds())
    return 0


# ------------------------------------------------------------------ Excel builder
def build_excel(df: pd.DataFrame, path: str, started: datetime) -> None:
    """Build the styled Excel workbook using the xlsx skill design system."""
    sys.path.insert(0, "/home/z/my-project/skills/xlsx/templates")
    from base import (
        FONT_NAME, HEADER_BOLD, PRIMARY, SECONDARY, NEUTRAL_0, NEUTRAL_100,
        NEUTRAL_200, NEUTRAL_600, NEUTRAL_900, ACCENT_POSITIVE, ACCENT_NEGATIVE,
        setup_sheet, style_header_row, style_data_row, style_total_row,
        auto_fit_columns,
    )
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.chart import BarChart, Reference
    from openpyxl.chart.label import DataLabelList

    wb = Workbook()
    wb.properties.creator = "Z.ai"

    # ===================== Sheet 1: Top 10 Stocks =====================
    ws = wb.active
    ws.title = "Top 10 Momentum Stocks"
    ws.sheet_view.showGridLines = False

    headers = [
        "Rank", "Symbol", "Company", "Sector",
        "Price (₹)", "50 DMA", "200 DMA",
        "RSI(14)", "Mkt Cap (₹ Cr)", "30D Avg Vol",
        "1M Ret %", "3M Ret %", "6M Ret %",
        "Ann Vol %", "Sharpe",
        "52W High", "52W Low", "% Below High", "% Above 200DMA",
    ]
    last_col = len(headers) + 1  # data starts at column B (=2)

    title = f"Nifty Total Market — Momentum Screen — Top 10 (as of {datetime.now().strftime('%Y-%m-%d')})"
    setup_sheet(ws, title=title, last_col=last_col)

    # headers at row 4
    for i, h in enumerate(headers, start=2):
        ws.cell(row=4, column=i, value=h)
    style_header_row(ws, row_num=4, col_start=2, col_end=last_col)

    # data rows
    pct_fmt = "0.00"
    inr_fmt = "#,##0.00"
    inr_int = "#,##0"
    cr_fmt = "#,##0"

    for i, (_, r) in enumerate(df.iterrows()):
        row_num = 5 + i
        cells = [
            int(r["rank"]),
            r["symbol"],
            r.get("long_name", "") or r["symbol"],
            r.get("sector", "—"),
            round(r["current_price"], 2),
            round(r["dma_50"], 2),
            round(r["dma_200"], 2),
            round(r["rsi_14"], 1),
            round(r["market_cap_cr"], 0) if pd.notna(r["market_cap_cr"]) else None,
            round(r["avg_volume_30d"], 0),
            round(r["ret_1m_pct"], 2) if pd.notna(r["ret_1m_pct"]) else None,
            round(r["ret_3m_pct"], 2) if pd.notna(r["ret_3m_pct"]) else None,
            round(r["ret_6m_pct"], 2) if pd.notna(r["ret_6m_pct"]) else None,
            round(r["ann_vol_pct"], 2) if pd.notna(r["ann_vol_pct"]) else None,
            round(r["sharpe"], 2) if pd.notna(r["sharpe"]) else None,
            round(r["high_52w"], 2),
            round(r["low_52w"], 2),
            round(r["pct_below_high"], 2) if pd.notna(r["pct_below_high"]) else None,
            round(r["pct_above_200dma"], 2) if pd.notna(r["pct_above_200dma"]) else None,
        ]
        for j, v in enumerate(cells, start=2):
            ws.cell(row=row_num, column=j, value=v)
        style_data_row(ws, row_num=row_num, col_start=2, col_end=last_col, row_index=i)

        # number formats — cols F (6) onwards are numeric
        # Rank(2) | Symbol(3) | Company(4) | Sector(5) | Price(6) | 50DMA(7) | 200DMA(8) |
        # RSI(9) | MCap(10) | Vol(11) | 1M(12) | 3M(13) | 6M(14) | Vol%(15) | Sharpe(16) |
        # 52WHigh(17) | 52WLow(18) | %BelowHigh(19) | %Above200DMA(20)
        for c in (6, 7, 8, 17, 18):  # price-like
            ws.cell(row=row_num, column=c).number_format = inr_fmt
        ws.cell(row=row_num, column=9).number_format = "0.0"  # RSI
        ws.cell(row=row_num, column=10).number_format = cr_fmt  # MCap Cr
        ws.cell(row=row_num, column=11).number_format = inr_int  # Vol
        for c in (12, 13, 14, 15, 19, 20):  # percent cols
            ws.cell(row=row_num, column=c).number_format = "0.00"
        ws.cell(row=row_num, column=16).number_format = "0.00"  # Sharpe

        # color the 6M return cell green for emphasis
        cell_6m = ws.cell(row=row_num, column=14)
        if pd.notna(r["ret_6m_pct"]) and r["ret_6m_pct"] > 0:
            cell_6m.font = Font(name=FONT_NAME, size=11, color=ACCENT_POSITIVE, bold=HEADER_BOLD)
        elif pd.notna(r["ret_6m_pct"]) and r["ret_6m_pct"] < 0:
            cell_6m.font = Font(name=FONT_NAME, size=11, color=ACCENT_NEGATIVE, bold=HEADER_BOLD)

    # auto-fit column widths
    auto_fit_columns(ws, min_width=10, max_width=30, header_row=4, data_start_row=5)
    # explicitly widen company name
    ws.column_dimensions["D"].width = 30
    ws.column_dimensions["E"].width = 22
    ws.freeze_panes = "C5"

    # Add a bar chart of 6M return %
    if len(df) > 0:
        chart = BarChart()
        chart.type = "bar"
        chart.style = 11
        chart.title = "6-Month Price Return % — Top 10"
        chart.y_axis.title = "Stock"
        chart.x_axis.title = "6M Return %"
        chart.height = 12  # cm
        chart.width = 22

        # data: column N (14) = "6M Ret %" → col letter N
        data_ref = Reference(ws, min_col=14, min_row=4, max_row=4 + len(df), max_col=14)
        cat_ref = Reference(ws, min_col=3, min_row=5, max_row=4 + len(df), max_col=3)  # Symbol col
        chart.add_data(data_ref, titles_from_data=True)
        chart.set_categories(cat_ref)
        chart.dataLabels = DataLabelList(showVal=True)
        # anchor below the data table
        chart_anchor = f"B{5 + len(df) + 3}"
        ws.add_chart(chart, chart_anchor)

    # ===================== Sheet 2: Methodology =====================
    ws2 = wb.create_sheet("Methodology")
    ws2.sheet_view.showGridLines = False

    method_headers = ["#", "Rule", "Operator", "Value", "Rationale"]
    last_col2 = len(method_headers) + 1
    setup_sheet(ws2, title="Momentum Strategy — Rules & Methodology", last_col=last_col2)
    for i, h in enumerate(method_headers, start=2):
        ws2.cell(row=4, column=i, value=h)
    style_header_row(ws2, row_num=4, col_start=2, col_end=last_col2)

    rules = [
        ("Current Price", ">", "200 Daily MA", "Confirms long-term uptrend"),
        ("Current Price", ">", "50 Daily MA", "Confirms short-term strength"),
        ("50 DMA", ">", "200 DMA", "Golden-cross alignment (trend confirmation)"),
        ("RSI(14)", ">", "55", "Momentum not yet overbought (>70) but in strong zone"),
        ("Market Cap", ">", "₹500 Cr", "Excludes micro-caps — ensures liquidity"),
        ("30D Avg Volume", ">", "50,000 shares/day", "Tradeable liquidity"),
        ("Sort", "ORDER BY", "6M Return % DESC", "Rank by relative strength"),
        ("Universe", "≈", "Nifty Total Market (~250 NSE names)", "Coverage breadth"),
        ("Top N", "LIMIT", "10", "Concentrated shortlist"),
    ]
    for i, row in enumerate(rules):
        rn = 5 + i
        ws2.cell(row=rn, column=2, value=i + 1)
        ws2.cell(row=rn, column=3, value=row[0])
        ws2.cell(row=rn, column=4, value=row[1])
        ws2.cell(row=rn, column=5, value=row[2])
        ws2.cell(row=rn, column=6, value=row[3])
        style_data_row(ws2, row_num=rn, col_start=2, col_end=last_col2, row_index=i)
    auto_fit_columns(ws2, min_width=10, max_width=40, header_row=4, data_start_row=5)
    ws2.column_dimensions["F"].width = 45

    # Add notes block
    notes_start = 5 + len(rules) + 2
    note_lines = [
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  (run started {started.isoformat(timespec='seconds')})",
        f"Universe size: {len(UNIVERSE)} NSE symbols",
        "Data source: Yahoo Finance (yfinance 1.7+) — daily OHLCV, 18 months of history",
        "RSI uses Wilder's smoothing (EWM alpha=1/14).",
        "1M / 3M / 6M returns use 21 / 63 / 126 trading days.",
        "Annualized volatility = std(daily returns) × √252, last 126 days.",
        "Sharpe = mean(daily returns) / std(daily returns) × √252 (rf=0).",
        "Market cap sourced from Yahoo .info; 1 Cr = 10,000,000 INR.",
        "Re-run: python3 /home/z/my-project/scripts/nifty_momentum_screen.py",
    ]
    for i, line in enumerate(notes_start + np.arange(len(note_lines))):
        pass
    for i, line in enumerate(note_lines):
        c = ws2.cell(row=notes_start + i, column=2, value=line)
        c.font = Font(name=FONT_NAME, size=10, color=NEUTRAL_600, italic=True)
        ws2.merge_cells(start_row=notes_start + i, start_column=2,
                        end_row=notes_start + i, end_column=last_col2)

    wb.save(path)


if __name__ == "__main__":
    sys.exit(main())
