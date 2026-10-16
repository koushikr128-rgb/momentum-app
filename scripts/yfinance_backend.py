"""
Backend script called by Next.js API routes.
Outputs JSON to stdout.

Usage:
  python3 yfinance_backend.py screen
  python3 yfinance_backend.py stops TICKER1,TICKER2,ENTRY1,ENTRY2,...
"""
import sys, json, time, os
from concurrent.futures import ThreadPoolExecutor, as_completed
import yfinance as yf
import pandas as pd
import numpy as np

UNIVERSE = [
    "ABFRL", "ADANIENT", "ADANIPORTS", "ATGL", "AWL",
    "ASHOKLEY", "BALKRISIND", "BOSCHLTD", "BHEL", "EICHERMOT", "EXIDEIND",
    "MRF", "MOTHERSON", "TATAELXSI", "TIINDIA", "ENDURANCE", "OLECTRA",
    "SBIN", "HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "INDUSINDBK",
    "PNB", "BANKBARODA", "CANBK", "IDFCFIRSTB", "FEDERALBNK", "AUBANK",
    "BANDHANBNK", "SBICARD", "LICHSGFIN", "PFC", "RECLTD",
    "MUTHOOTFIN", "CHOLAFIN", "BAJFINANCE", "BAJAJFINSV", "BAJAJHLDNG",
    "SHRIRAMFIN", "IIFL", "LTF", "MANAPPURAM",
    "HDFCLIFE", "SBILIFE", "ICICIPRULI", "ICICIGI", "NIACL", "STARHEALTH",
    "ULTRACEMCO", "SHREECEM", "AMBUJACEM", "ACC", "GRASIM", "RAMCOCEM",
    "DALBHARAT", "JKCEMENT", "HEIDELBERG",
    "PIDILITIND", "SRF", "TATACHEM", "AARTIIND", "PIIND",
    "LINDEINDIA", "NAVINFLUOR", "TANLA", "ATUL", "BHARATRAS",
    "DEEPAKNTR", "CHAMBLFERT", "COROMANDEL", "FACT", "GMMPFAUDLR",
    "FINEORG", "AMBER", "KAYNES",
    "HINDUNILVR", "NESTLEIND", "ITC", "BRITANNIA", "DABUR", "GODREJCP",
    "MARICO", "TATACONSUM", "COLPAL", "EMAMILTD", "PGHH", "VSTIND",
    "RADICO", "MCDOWELL-N", "HATSUN", "KRBL",
    "RELIANCE", "ONGC", "NTPC", "POWERGRID", "IOC", "BPCL", "HINDPETRO",
    "GAIL", "COALINDIA", "TATAPOWER", "ADANIPOWER", "THERMAX",
    "NHPC", "SJVN", "SUZLON", "KEI",
    "JSWENERGY", "CESC", "IGL", "MGL", "GUJGASLTD",
    "HDFCAMC", "UTIAMC", "ABCAPITAL",
    "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "LUPIN", "AUROPHARMA",
    "BIOCON", "TORNTPHARM", "ALKEM", "ABBOTINDIA", "IPCALAB",
    "LAOPALA", "SYNGENE", "MAXHEALTH", "POLYMED", "LAURUSLABS", "JBCHEPHARM",
    "FORTIS", "GLENMARK", "WOCKPHARMA",
    "TCS", "INFY", "WIPRO", "HCLTECH", "TECHM", "LTIM", "PERSISTENT",
    "COFORGE", "MPHASIS", "OFSS", "BSOFT", "LTTS",
    "SASKEN", "KERNEX", "INTELLECT", "ECLERX",
    "LT", "ABB", "SIEMENS", "CUMMINSIND", "CGPOWER",
    "ENIL", "SUPREMEIND", "PNCINFRA", "KNRCON",
    "HUDCO", "IRB",
    "PRESTIGE", "GODREJPROP", "OBEROIRLTY", "DLF", "LODHA",
    "ANANTRAJ", "SUNTECK",
    "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "JINDALSTEL", "SAIL",
    "NMDC", "NATIONALUM", "APLAPOLLO", "JSL", "RATNAMANI",
    "WELCORP", "HINDZINC",
    "BHARTIARTL", "IDEA", "INDUSTOWER",
    "SUNTV", "NETWORK18", "TVTODAY", "PVRINOX",
    "ZEEL",
    "SOBHA",
    "TRENT", "DMART", "TITAN", "JUBLFOOD", "INDHOTEL",
    "INDIGO", "EIHOTEL", "ASIANPAINT", "BERGERPAINT",
    "HAVELLS", "BAJAJELEC", "VOLTAS", "BLUESTAR",
    "CROMPTON", "POLYCAB", "FINCABLES",
    "KSB", "WHIRLPOOL", "TTKPRESTIG",
    "HONAUT", "TATACOMM",
    "BAJAJ-AUTO", "M&M", "M&MFIN", "HEROMOTOCO", "MARUTI",
    "TATAMOTORS", "TATAINVEST", "TVSMOTOR",
    "CDSL", "CAMS", "MCX", "IEX", "TEJASNET",
    "MAZDOCK", "HAL", "BEL", "BDL",
    "ASTRAL", "PRINCEPIPE",
    "MASTEK", "TARSONS",
    "ZOMATO", "PAYTM", "POLICYBZR", "NAUKRI", "INDIAMART",
    "DELHIVERY", "CONCOR", "TCI", "TCIEXP", "BLUEJET",
    "ANGELONE",
    "RAYMOND", "GICRE",
    "VIPIND", "MINDACORP", "TALBROAUTO", "BATAINDIA", "FILATEX",
    "TIMKEN", "SKFINDIA", "SCHAEFFLER",
    "MFSL", "AETHER",
    # ---- Curated mid + small cap additions (high-quality names likely to pass momentum filters) ----
    "AARTIDRUGS", "AARTIPHARM", "BAYERCROP", "BLISSGVS", "FDC",
    "GLENMARKLIFE", "GRANULES", "NATCO", "NEULAND", "PANACEABIO",
    "SANOFI", "SHILPAMED", "STRIDES", "SUVEN", "THYROCARE",
    "WOCKPHARMA",
    "ACRYSIL", "AETHERIND", "APARINDS", "BALAJIAMINE", "BASF",
    "BHARATRAS", "BORORENEW", "DCMSHRIRAM", "EIDPARRY", "FINEORG",
    "GHCL", "GNFC", "GOCLCORP", "GRAPHITE", "GRAVITA",
    "GUJALKALI", "NAVINFLUOR", "NOCIL", "ROSSARI", "SOLARINDS",
    "VINATIORGA",
    "CARBORUNIV", "FIEMIND", "FORCEMOT", "GABRIEL", "JBM",
    "METROBRAND", "PRECISION", "RICOAUTO", "SUBROS", "SUNFLAG",
    "UNOMINDA", "VARROC",
    "BANKINDIA", "CANFINHOME", "DCBBANK", "EQUITASBNK", "IDBI",
    "INDIANB", "KARURVYSYA", "SOUTHINDIAN", "SUNDARMFIN",
    "BLUEDART", "CCL", "GILLETTE", "NILKAMAL", "PATANJALI",
    "VENKEYS", "VSTIND",
    "DELTACORP", "DIXON", "GMRINFRA", "HERITGFOOD", "INOXWIND",
    "JKLAKSHMI", "KANSAINER", "KIRLOSBROS", "LAXMIMACH", "LODHA",
    "MAHABANK", "MEGH", "METROPOLIS", "OBEROIRLTY", "PAGEIND",
    "PHOENIX", "PRECAM", "PRINCEPIPE", "RAMCOCEM", "SCHAEFFLER",
    "SELANE", "SKFINDIA", "SOBHA", "TIMKEN", "TTKPRESTIG",
    "BSE", "HAPPY", "LATENTVIEW", "MAPMYINDIA", "NYKAA",
    "PAYTM", "PBFINTECH", "POLICYBZR", "ZOMATO",
    "ADANIGREEN", "INDIGAS", "KEC", "OIL", "TPGPWR",
]
UNIVERSE = list(dict.fromkeys(UNIVERSE))

# Override with CSV universe if available (750 stocks vs 276 hardcoded)
import csv as _csv2
import os as _os2
_CSV_PATH = "/home/z/my-project/data/nifty750.csv"
if _os2.path.exists(_CSV_PATH):
    try:
        _csv_symbols = []
        with open(_CSV_PATH, "r", encoding="utf-8-sig") as _f2:
            _reader2 = _csv2.DictReader(_f2)
            for _row2 in _reader2:
                _s = (_row2.get("Symbol") or "").strip()
                if _s:
                    _csv_symbols.append(_s)
        if len(_csv_symbols) > 100:
            UNIVERSE = list(dict.fromkeys(_csv_symbols))
            print(f"Loaded {len(UNIVERSE)} symbols from CSV", file=sys.stderr)
    except Exception:
        pass


def compute_metrics(symbol, candles_df):
    if candles_df is None or len(candles_df) < 220:
        return None
    close = candles_df["Close"].squeeze().dropna()
    volume = candles_df["Volume"].squeeze().dropna()
    if len(close) < 220 or len(volume) < 30:
        return None
    current = float(close.iloc[-1])
    if not np.isfinite(current) or current <= 0:
        return None
    dma50 = float(close.tail(50).mean())
    dma200 = float(close.tail(200).mean())
    dma20 = float(close.tail(20).mean())
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1.0/14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0/14, adjust=False).mean().replace(0.0, np.nan)
    rs = avg_gain / avg_loss
    rsi = (100.0 - 100.0 / (1.0 + rs)).iloc[-1]
    if not np.isfinite(rsi):
        rsi = 50.0
    avg_vol = float(volume.tail(30).mean())

    def ret(n):
        if len(close) <= n:
            return None
        p = float(close.iloc[-1 - n])
        return None if p <= 0 else (current / p - 1.0) * 100.0

    daily_ret = close.pct_change().dropna().tail(126)
    if len(daily_ret) > 20:
        vol_d = float(daily_ret.std(ddof=1))
        ann_vol = vol_d * np.sqrt(252) * 100
        mean_d = float(daily_ret.mean())
        sharpe = (mean_d / vol_d) * np.sqrt(252) if vol_d > 0 else 0.0
    else:
        ann_vol = None
        sharpe = None
    win = close.tail(252) if len(close) >= 252 else close
    high = float(win.max())
    low = float(win.min())
    pct_above_20dma = (current / dma20 - 1) * 100 if dma20 > 0 else 0.0

    r6 = max(-50, min(200, ret(126) or 0))
    r3 = max(-30, min(120, ret(63) or 0))
    r1 = max(-20, min(80, ret(21) or 0))
    rsi_val = float(rsi)
    if rsi_val > 80:
        rsi_score = 50 - (rsi_val - 80) * 2
    elif rsi_val < 50:
        rsi_score = rsi_val
    else:
        rsi_score = 50 + (rsi_val - 50) * 1.5
    sharpe_val = sharpe or 0
    sharpe_score = max(0, min(100, sharpe_val * 30))
    momentum_score = max(0, min(100,
        0.40 * (r6 / 2 + 25) +
        0.20 * (r3 / 2.4 + 25) +
        0.15 * (r1 / 1.6 + 25) +
        0.15 * rsi_score +
        0.10 * sharpe_score
    ))

    # ===== Setup Classification =====
    last50_vols = volume.tail(50)
    avg_vol_50 = float(last50_vols.mean()) if len(last50_vols) > 0 else 1.0
    last_vol = float(volume.iloc[-1]) if len(volume) > 0 else 0.0
    vol_mult = (last_vol / avg_vol_50) if avg_vol_50 > 0 else 1.0

    last20_close = close.tail(20)
    mean20 = float(last20_close.mean())
    std20 = float(last20_close.std(ddof=1)) if len(last20_close) > 1 else 0.0
    bb_width = (4 * std20 / mean20 * 100) if mean20 > 0 else 0.0

    lookback = min(len(close) - 20, 126)
    bb_widths_6m = []
    for i in range(0, lookback, 5):
        start = len(close) - 20 - lookback + i
        if start < 0:
            break
        w = close.iloc[start:start + 20]
        if len(w) == 20:
            m = float(w.mean())
            s = float(w.std(ddof=1)) if len(w) > 1 else 0.0
            if m > 0:
                bb_widths_6m.append(4 * s / m * 100)
    bb_width_6m_pct = (
        sum(1 for w in bb_widths_6m if w <= bb_width) / len(bb_widths_6m) * 100
    ) if bb_widths_6m else 50.0

    if len(close) >= 21:
        last20_high = float(close.iloc[-21:-1].max())
        last20_low = float(close.iloc[-21:-1].min())
    else:
        last20_high = high
        last20_low = low

    last_open = float(candles_df["Open"].squeeze().iloc[-1]) if "Open" in candles_df.columns else current
    is_up_day = current >= last_open
    if vol_mult > 1.3 and is_up_day:
        vsa_tag = "ACCUM"
    elif vol_mult > 1.3 and not is_up_day:
        vsa_tag = "DIST"
    else:
        vsa_tag = "NEUTRAL"

    is_uptrend = current > dma50 and dma50 > dma200
    is_extended = rsi_val > 75 or pct_above_20dma > 12
    is_pullback = is_uptrend and -2 <= pct_above_20dma <= 4 and 40 <= rsi_val <= 60
    is_breakout = current > last20_high * 1.005 and vol_mult > 1.5
    is_tightening = bb_width_6m_pct < 15 and not is_breakout
    is_distribution = vsa_tag == "DIST" and rsi_val > 65

    if is_distribution:
        setup_type = "DISTRIBUTION"
    elif is_breakout:
        setup_type = "BREAKOUT"
    elif is_extended:
        setup_type = "EXTENDED"
    elif is_pullback:
        setup_type = "PULLBACK"
    elif is_tightening:
        setup_type = "TIGHTENING"
    else:
        setup_type = "UPTREND"

    # ===== Signal Score =====
    if is_uptrend:
        trend_score = max(0, min(100, 60 + (20 if pct_above_20dma > 0 else 0) + (20 if 0 < pct_above_20dma < 8 else 10)))
    else:
        trend_score = max(0, min(100, 30 + (20 if current > dma50 else 0)))

    mom_score = max(0, min(100,
        0.5 * (rsi_val if rsi_val < 80 else 80 - (rsi_val - 80) * 1.5) +
        0.5 * max(0, min(100, r1 * 1.5 + 40))
    ))
    vol_score = max(0, min(100, vol_mult * 30 + 20))
    pct_above_200 = (current / dma200 - 1) * 100 if dma200 > 0 else 0
    rs_proxy = min(pct_above_200 * 2 + 30, 100) if pct_above_200 > 0 else 20

    if -2 <= pct_above_20dma <= 5:
        timing_score = 90 + (5 - abs(pct_above_20dma - 1.5)) * 2
    elif 5 < pct_above_20dma <= 12:
        timing_score = 70 - (pct_above_20dma - 5) * 4
    elif pct_above_20dma > 12:
        timing_score = 30
    else:
        timing_score = 60

    setup_quality = {
        "BREAKOUT": 95, "PULLBACK": 88, "UPTREND": 70,
        "TIGHTENING": 55, "EXTENDED": 35, "DISTRIBUTION": 20,
    }
    signal_score = max(0, min(100, round(
        0.35 * trend_score +
        0.25 * mom_score +
        0.15 * vol_score +
        0.15 * rs_proxy +
        0.10 * timing_score +
        0.10 * setup_quality[setup_type]
    )))

    # ===== Trade Plan with per-setup R:R =====
    entry_price = current
    add_price = dma20
    if setup_type == "BREAKOUT":
        stop_price = min(last20_low, last20_high * 0.97)
    elif setup_type == "PULLBACK":
        stop_price = dma20 * 0.985
    elif setup_type == "EXTENDED":
        stop_price = dma20 * 1.02
    elif setup_type == "DISTRIBUTION":
        stop_price = min(last20_low, current * 0.96)
    elif setup_type == "TIGHTENING":
        stop_price = last20_low * 0.98
    else:
        stop_price = dma50 * 0.98

    RR_PRESETS = {
        "BREAKOUT":     {"t1": 1.5, "t2": 3.0},
        "PULLBACK":     {"t1": 1.5, "t2": 2.5},
        "EXTENDED":     {"t1": 1.0, "t2": 2.0},
        "DISTRIBUTION": {"t1": 0.7, "t2": 1.5},
        "TIGHTENING":   {"t1": 1.5, "t2": 2.5},
        "UPTREND":      {"t1": 1.5, "t2": 2.8},
    }
    rr_preset = RR_PRESETS.get(setup_type, {"t1": 1.5, "t2": 2.8})
    risk_per_share = entry_price - stop_price
    target1 = entry_price + risk_per_share * rr_preset["t1"]
    target2 = entry_price + risk_per_share * rr_preset["t2"]
    risk_reward = max(0, min(10, (target2 - entry_price) / risk_per_share)) if risk_per_share > 0 else 0.0

    if signal_score >= 85 and risk_reward >= 2.5:
        setup_grade = "A+"
    elif signal_score >= 75 and risk_reward >= 2:
        setup_grade = "A"
    elif signal_score >= 60:
        setup_grade = "B"
    else:
        setup_grade = "C"

    return {
        "symbol": symbol,
        "lastDate": close.index[-1].strftime("%Y-%m-%d"),
        "currentPrice": current,
        "dma50": dma50,
        "dma200": dma200,
        "dma20": dma20,
        "rsi14": float(rsi),
        "avgVolume30d": avg_vol,
        "ret1wPct": ret(5),
        "ret1mPct": ret(21),
        "ret3mPct": ret(63),
        "ret6mPct": ret(126),
        "annVolPct": ann_vol,
        "sharpe": sharpe,
        "high52w": high,
        "low52w": low,
        "pctBelowHigh": (current / high - 1) * 100 if high > 0 else None,
        "pctAboveLow": (current / low - 1) * 100 if low > 0 else None,
        "pctAbove200dma": (current / dma200 - 1) * 100 if dma200 > 0 else None,
        "momentumScore": float(momentum_score),
        "signalScore": float(signal_score),
        "setupType": setup_type,
        "setupGrade": setup_grade,
        "entryPrice": entry_price,
        "addPrice": add_price,
        "stopPrice": stop_price,
        "target1": target1,
        "target2": target2,
        "riskReward": float(risk_reward),
        "volMult": float(vol_mult),
        "pctAbove20dma": float(pct_above_20dma),
        "vsaTag": vsa_tag,
        "bollingerWidth": float(bb_width),
        "bbWidth6mPct": float(bb_width_6m_pct),
    }


def cmd_screen(top_n: int = 10, filters: dict | None = None):
    """Run screen with optional custom filter thresholds.

    filters keys (all optional, defaults match user's original strategy):
      - rsi_min (float, default 50 — was 55, loosened to yield more qualifiers)
      - mcap_min_cr (float, default 200 — was 500, loosened)
      - vol_min (int, default 20000 — was 50000, loosened)
    """
    f = filters or {}
    rsi_min = float(f.get("rsi_min", 50))
    mcap_min_cr = float(f.get("mcap_min_cr", 200))
    vol_min = float(f.get("vol_min", 20000))

    tickers = [f"{s}.NS" for s in UNIVERSE]
    # 14 months is enough for 200 DMA (~9mo) + 6M returns + 30D volume buffer
    # Retry up to 3 times with backoff to handle Yahoo rate limiting
    raw = None
    for attempt in range(3):
        try:
            raw = yf.download(tickers, period="1y", group_by="ticker",
                             threads=False, progress=False, auto_adjust=False)
            # Check if we got meaningful data (not all NaN)
            if raw is not None and len(raw) > 100:
                break
            else:
                print(f"Attempt {attempt+1}: got {0 if raw is None else len(raw)} rows, retrying...", file=sys.stderr)
        except Exception as e:
            print(f"Attempt {attempt+1} failed: {e}", file=sys.stderr)
        if attempt < 2:
            import time as _time
            _time.sleep(5 * (attempt + 1))  # 5s, 10s backoff

    if raw is None or len(raw) < 100:
        print(json.dumps({
            "universeSize": len(UNIVERSE),
            "passedData": 0,
            "passedTech": 0,
            "passedMc": 0,
            "top10": [],
            "runAt": pd.Timestamp.now(tz="UTC").isoformat(),
            "error": "Yahoo Finance rate-limited all download attempts. Please try again in a few minutes.",
        }))
        return
    metrics = []
    for sym in UNIVERSE:
        try:
            if isinstance(raw.columns, pd.MultiIndex):
                if f"{sym}.NS" not in raw.columns.get_level_values(0):
                    continue
                df = raw[f"{sym}.NS"].dropna(subset=["Close"])
            else:
                df = raw.dropna(subset=["Close"])
        except Exception:
            continue
        m = compute_metrics(sym, df)
        if m:
            metrics.append(m)
    # Technical + volume filter — now parameterized
    passed_tech = [m for m in metrics
                   if m["currentPrice"] > m["dma200"]
                   and m["currentPrice"] > m["dma50"]
                   and m["dma50"] > m["dma200"]
                   and m["rsi14"] > rsi_min
                   and m["avgVolume30d"] > vol_min
                   and m["ret6mPct"] is not None]

    # Load market cap + sector from CSV (if available) — eliminates slow .info calls
    import csv as _csv
    import os as _os

    CSV_PATH = "/home/z/my-project/data/nifty750.csv"
    csv_lookup = {}  # symbol → {marketCapCr, sector, longName, industry}
    if _os.path.exists(CSV_PATH):
        try:
            with open(CSV_PATH, "r", encoding="utf-8-sig") as _f:
                _reader = _csv.DictReader(_f)
                for _row in _reader:
                    _sym = (_row.get("Symbol") or "").strip()
                    if not _sym:
                        continue
                    _mc_raw = (_row.get("Market Capital (? Cr)") or "").replace("?", "").replace(",", "").replace("₹", "").strip()
                    try:
                        _mc = float(_mc_raw)
                    except (ValueError, TypeError):
                        _mc = 0
                    _sector = (_row.get("Industry") or "—").strip()
                    _name = (_row.get("Company Name") or _sym).strip()
                    csv_lookup[_sym] = {
                        "marketCapCr": _mc,
                        "sector": _sector,
                        "longName": _name,
                        "industry": _sector,
                    }
        except Exception:
            pass

    out = []
    if csv_lookup:
        # Use CSV data — instant, no Yahoo .info calls needed
        for m in passed_tech:
            csv_data = csv_lookup.get(m["symbol"])
            if not csv_data:
                continue
            if csv_data["marketCapCr"] <= mcap_min_cr:
                continue
            out.append({
                **m,
                "longName": csv_data["longName"],
                "sector": csv_data["sector"],
                "industry": csv_data["industry"],
                "marketCapCr": csv_data["marketCapCr"],
            })
    else:
        # Fallback: fetch market cap + sector via yfinance .info (sequential)
        import time as _time
        for i, m in enumerate(passed_tech):
            try:
                t = yf.Ticker(f"{m['symbol']}.NS")
                info = t.info or {}
                mc = info.get("marketCap")
                if mc is None:
                    continue
                long_name = info.get("longName") or info.get("shortName") or m["symbol"]
                out.append({
                    **m,
                    "longName": long_name,
                    "sector": info.get("sector") or "—",
                    "industry": info.get("industry") or "—",
                    "marketCapCr": float(mc) / 1e7,
                })
                if i > 0 and i % 10 == 0:
                    _time.sleep(0.3)
            except Exception:
                continue

    # Filter by market cap
    out = [s for s in out if s["marketCapCr"] > mcap_min_cr]
    out.sort(key=lambda x: x.get("signalScore", 0), reverse=True)
    out = out[:top_n]
    for i, s in enumerate(out):
        s["rank"] = i + 1
    print(json.dumps({
        "universeSize": len(UNIVERSE),
        "passedData": len(metrics),
        "passedTech": len(passed_tech),
        "passedMc": len(out),
        "top10": out,
        "runAt": pd.Timestamp.now(tz="UTC").isoformat(),
    }, default=str))


def cmd_bridge_screen(top_n: int = 10, filters: dict | None = None):
    """Pullback Bridge Screener — finds stocks with:
    1. Monthly RSI 55-75 (macro filter — multi-month momentum active)
    2. Trend intact: Price > 50DMA > 200DMA
    3. At least one entry tactic READY or TRIGGERED (Daily 20 EMA / Anchor Candle / 50% Retracement)

    Returns top N stocks ranked by Bridge Score with trailing stop-loss levels.
    """
    f = filters or {}
    rsi_min = float(f.get("rsi_min", 50))
    mcap_min_cr = float(f.get("mcap_min_cr", 200))
    vol_min = float(f.get("vol_min", 20000))

    # Load CSV for market cap + sector (same as cmd_screen)
    import csv as _csv
    import os as _os

    CSV_PATH = "/home/z/my-project/data/nifty750.csv"
    csv_lookup = {}
    if _os.path.exists(CSV_PATH):
        try:
            with open(CSV_PATH, "r", encoding="utf-8-sig") as _f:
                _reader = _csv.DictReader(_f)
                for _row in _reader:
                    _sym = (_row.get("Symbol") or "").strip()
                    if not _sym:
                        continue
                    _mc_raw = (_row.get("Market Capital (? Cr)") or "").replace("?", "").replace(",", "").replace("₹", "").strip()
                    try:
                        _mc = float(_mc_raw)
                    except (ValueError, TypeError):
                        _mc = 0
                    _sector = (_row.get("Industry") or "—").strip()
                    _name = (_row.get("Company Name") or _sym).strip()
                    csv_lookup[_sym] = {
                        "marketCapCr": _mc,
                        "sector": _sector,
                        "longName": _name,
                        "industry": _sector,
                    }
        except Exception:
            pass

    # Download 18mo daily data — use top 250 by market cap for speed
    # (full 750 takes 70s+ which times out through proxy; top 250 takes ~25s)
    if csv_lookup:
        # Sort by market cap DESC, take top 250
        sorted_syms = sorted(csv_lookup.keys(), key=lambda s: csv_lookup[s].get("marketCapCr", 0), reverse=True)
        symbols = sorted_syms[:250]
    else:
        symbols = UNIVERSE[:250]

    tickers = [f"{s}.NS" for s in symbols]
    print(f"[bridge] Downloading 18mo data for {len(tickers)} stocks (top 250 by mcap)...", file=sys.stderr)

    raw = None
    for attempt in range(3):
        try:
            raw = yf.download(tickers, period="18mo", group_by="ticker",
                             threads=True, progress=False, auto_adjust=False)
            if raw is not None and len(raw) > 200:
                break
            else:
                print(f"[bridge] Attempt {attempt+1}: got {0 if raw is None else len(raw)} rows, retrying...", file=sys.stderr)
        except Exception as e:
            print(f"[bridge] Attempt {attempt+1} failed: {e}", file=sys.stderr)
        if attempt < 2:
            import time as _time
            _time.sleep(3 * (attempt + 1))

    if raw is None or len(raw) < 200:
        print(json.dumps({
            "universeSize": len(symbols),
            "passedData": 0,
            "passedTech": 0,
            "passedMc": 0,
            "top10": [],
            "runAt": pd.Timestamp.now(tz="UTC").isoformat(),
            "error": "Yahoo Finance rate-limited all download attempts.",
        }))
        return

    # Compute metrics + Pullback Bridge for each stock
    candidates = []
    for sym in symbols:
        try:
            if isinstance(raw.columns, pd.MultiIndex):
                if f"{sym}.NS" not in raw.columns.get_level_values(0):
                    continue
                df = raw[f"{sym}.NS"].dropna(subset=["Close"])
            else:
                df = raw.dropna(subset=["Close"])
            if df is None or len(df) < 220:
                continue
        except Exception:
            continue

        m = compute_metrics(sym, df)
        if not m:
            continue

        # Pre-filter: trend intact + RSI > rsi_min + volume
        if not (m["currentPrice"] > m["dma50"] and m["dma50"] > m["dma200"]):
            continue
        if m["rsi14"] < rsi_min:
            continue
        if m["avgVolume30d"] < vol_min:
            continue

        # Market cap filter
        csv_data = csv_lookup.get(sym, {})
        mc = csv_data.get("marketCapCr", 0)
        if mc <= mcap_min_cr:
            continue

        # Compute Pullback Bridge
        pb = _compute_pullback_bridge(df)
        if not pb or pb.get("error"):
            continue

        # Monthly RSI filter (55-75 — slightly wider than 60-72 to catch boundary candidates)
        monthly_rsi = pb.get("monthly_rsi", 50)
        if monthly_rsi < 55 or monthly_rsi > 75:
            continue

        # At least one tactic READY or TRIGGERED
        tactics = pb.get("entry_tactics", [])
        ready_tactics = [t for t in tactics if t["status"] in ("READY", "TRIGGERED")]
        if not ready_tactics:
            continue

        # Compute Bridge Score (0-100)
        # Monthly RSI position (30%): 60-72 = 100, scaled outside
        if 60 <= monthly_rsi <= 72:
            rsi_score = 100
        elif 55 <= monthly_rsi < 60:
            rsi_score = 50 + (monthly_rsi - 55) * 10  # 55→50, 60→100
        elif 72 < monthly_rsi <= 75:
            rsi_score = 100 - (monthly_rsi - 72) * 16.67  # 72→100, 75→50
        else:
            rsi_score = 0

        # Tactic readiness (30%): each READY = 33, TRIGGERED = 50, capped at 100
        tactic_score = min(100, sum(
            50 if t["status"] == "TRIGGERED" else 33
            for t in ready_tactics
        ))

        # Trend alignment (20%): already pre-filtered = 100
        trend_score = 100

        # Volume / VSA (10%)
        vol_score = 100 if m.get("vsaTag") == "ACCUM" or m.get("volMult", 1) > 1.3 else 50

        # Risk quality (10%): best tactic's risk%
        best_tactic = min(ready_tactics, key=lambda t: t["risk_pct"])
        risk_pct = best_tactic["risk_pct"]
        if risk_pct < 5:
            risk_score = 100
        elif risk_pct < 8:
            risk_score = 60
        else:
            risk_score = 30

        bridge_score = round(
            0.30 * rsi_score +
            0.30 * tactic_score +
            0.20 * trend_score +
            0.10 * vol_score +
            0.10 * risk_score
        )

        # Trailing SL: previous week's low (the Pullback Bridge 30-day emergency stop)
        trailing_sl = pb.get("prev_week_low")
        # Active tactic = the one with lowest risk% among ready ones
        active_tactic = best_tactic

        candidates.append({
            "symbol": sym,
            "longName": csv_data.get("longName", sym),
            "sector": csv_data.get("sector", "—"),
            "industry": csv_data.get("industry", "—"),
            "marketCapCr": mc,
            "currentPrice": m["currentPrice"],
            "rsi14": m["rsi14"],
            "monthlyRsi": monthly_rsi,
            "macroFilterPass": 60 <= monthly_rsi <= 72,
            "setupType": m.get("setupType", "UPTREND"),
            "setupGrade": m.get("setupGrade", "C"),
            "signalScore": m.get("signalScore", 0),
            "bridgeScore": bridge_score,
            "activeTactic": active_tactic["name"],
            "activeTacticId": active_tactic["id"],
            "entryPrice": active_tactic["entry"],
            "stopPrice": active_tactic["stop"],
            "trailingSL": trailing_sl,
            "riskPct": risk_pct,
            "riskRupees": active_tactic["entry"] - active_tactic["stop"],
            "daily20ema": pb.get("daily_20ema"),
            "weekly9ema": pb.get("weekly_9ema"),
            "swingLow": pb.get("swing_low"),
            "prevWeekLow": trailing_sl,
            "anchorCandle": pb.get("anchor_candle"),
            "monthRangeLow": pb.get("month_range_low"),
            "monthRangeHigh": pb.get("month_range_high"),
            "monthRange50pct": pb.get("month_range_50pct"),
            "allTactics": tactics,
            "ret1wPct": m.get("ret1wPct"),
            "ret1mPct": m.get("ret1mPct"),
            "ret6mPct": m.get("ret6mPct"),
            "volMult": m.get("volMult", 1),
            "vsaTag": m.get("vsaTag", "NEUTRAL"),
        })

    # Sort by Bridge Score DESC
    candidates.sort(key=lambda x: x["bridgeScore"], reverse=True)
    top = candidates[:top_n]
    for i, s in enumerate(top):
        s["rank"] = i + 1

    print(json.dumps({
        "universeSize": len(symbols),
        "passedData": len(candidates),
        "passedTech": len(candidates),
        "passedMc": len(top),
        "top10": top,
        "runAt": pd.Timestamp.now(tz="UTC").isoformat(),
        "screenType": "bridge",
    }, default=str))


def cmd_stops(payload):
    """payload: list of {symbol, entryPrice, shares, rupees, sector}"""
    symbols = [p["symbol"] for p in payload]
    tickers = [f"{s}.NS" for s in symbols]
    raw = yf.download(tickers, period="6mo", group_by="ticker",
                     threads=True, progress=False, auto_adjust=False)
    results = []
    for p in payload:
        sym = p["symbol"]
        try:
            if isinstance(raw.columns, pd.MultiIndex):
                df = raw[f"{sym}.NS"].dropna(subset=["Close"])
            else:
                df = raw.dropna(subset=["Close"])
        except Exception:
            continue
        close = df["Close"].squeeze().dropna()
        if len(close) < 50:
            continue
        current = float(close.iloc[-1])
        dma50 = float(close.tail(50).mean())
        peak = float(close.max())
        hard_stop = p["entryPrice"] * 0.92
        trailing = peak * 0.85
        trend_stop = dma50
        active = max(hard_stop, trailing, trend_stop)
        status = "HOLD"
        reasons = []
        if current < dma50:
            status = "EXIT"; reasons.append(f"Below 50 DMA (₹{dma50:.2f})")
        if current <= hard_stop:
            status = "EXIT"; reasons.append(f"Hard stop hit (₹{hard_stop:.2f})")
        if current <= trailing:
            status = "EXIT"; reasons.append(f"Trailing stop hit (₹{trailing:.2f})")
        if status != "EXIT":
            gaps = [
                ((current - trend_stop) / current, f"Near 50 DMA"),
                ((current - hard_stop) / current, f"Near hard stop"),
                ((current - trailing) / current, f"Near trailing stop"),
            ]
            for g, label in gaps:
                if g < 0.02:
                    status = "WATCH"; reasons.append(f"{label} ({g*100:+.1f}%)")
        pnl_pct = (current / p["entryPrice"] - 1) * 100
        pnl_rupees = (current - p["entryPrice"]) * p["shares"]
        results.append({
            "symbol": sym,
            "sector": p["sector"],
            "entryPrice": p["entryPrice"],
            "currentPrice": current,
            "dma50": dma50,
            "peakSinceEntry": peak,
            "hardStop": hard_stop,
            "trailingStop": trailing,
            "trendStop": trend_stop,
            "activeStop": active,
            "pnlPct": pnl_pct,
            "pnlRupees": pnl_rupees,
            "shares": p["shares"],
            "rupees": p["rupees"],
            "status": status,
            "reasons": "; ".join(reasons),
        })
    print(json.dumps({
        "stops": results,
        "runAt": pd.Timestamp.now(tz="UTC").isoformat(),
    }, default=str))


def cmd_nifty():
    """Fetch NIFTY 50 + breadth sample for /api/regime."""
    try:
        nifty = yf.download("^NSEI", period="1y", interval="1d", progress=False, threads=False)
        if nifty is None or len(nifty) < 220:
            print(json.dumps({"error": f"NIFTY data too short: {0 if nifty is None else len(nifty)} rows"}))
            return

        close = nifty["Close"].squeeze().dropna()
        volume = nifty["Volume"].squeeze().dropna() if "Volume" in nifty.columns else pd.Series(dtype=float)
        candles = []
        for i in range(len(nifty)):
            ts = nifty.index[i]
            epoch = int(ts.timestamp()) if hasattr(ts, "timestamp") else int(pd.Timestamp(ts).timestamp())
            row_open = float(nifty["Open"].iloc[i]) if "Open" in nifty.columns else float(close.iloc[i])
            row_high = float(nifty["High"].iloc[i]) if "High" in nifty.columns else float(close.iloc[i])
            row_low = float(nifty["Low"].iloc[i]) if "Low" in nifty.columns else float(close.iloc[i])
            row_close = float(nifty["Close"].iloc[i])
            row_vol = float(volume.iloc[i]) if len(volume) > i else 0.0
            candles.append({"timestamp": epoch, "open": row_open, "high": row_high, "low": row_low, "close": row_close, "volume": row_vol})

        breadth_sample = [
            "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
            "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "LT.NS", "BHARTIARTL.NS",
            "KOTAKBANK.NS", "AXISBANK.NS", "ASIANPAINT.NS", "MARUTI.NS", "SUNPHARMA.NS",
            "TITAN.NS", "ULTRACEMCO.NS", "NESTLEIND.NS", "WIPRO.NS", "ONGC.NS",
            "NTPC.NS", "POWERGRID.NS", "TATAMOTORS.NS", "TATASTEEL.NS", "JSWSTEEL.NS",
            "HCLTECH.NS", "BAJFINANCE.NS", "TECHM.NS", "GRASIM.NS", "COALINDIA.NS",
            "DRREDDY.NS", "CIPLA.NS", "DIVISLAB.NS", "HDFCLIFE.NS", "SBILIFE.NS",
            "BRITANNIA.NS", "EICHERMOT.NS", "ADANIENT.NS", "ADANIPORTS.NS", "BPCL.NS",
            "IOC.NS", "TATACONSUM.NS", "HEROMOTOCO.NS", "BAJAJFINSV.NS", "INDUSINDBK.NS",
            "BAJAJ-AUTO.NS", "SHRIRAMFIN.NS",
        ]
        breadth_data = yf.download(breadth_sample, period="3mo", interval="1d", group_by="ticker", progress=False, threads=False)
        advancing = 0
        total = 0
        for sym in breadth_sample:
            try:
                if breadth_data is None: break
                if hasattr(breadth_data.columns, "levels") and len(breadth_data.columns.levels) > 1:
                    if sym not in breadth_data.columns.get_level_values(0): continue
                    df = breadth_data[sym]["Close"].squeeze().dropna()
                else:
                    df = breadth_data["Close"].squeeze().dropna() if "Close" in breadth_data.columns else None
                    if df is None: continue
                if len(df) < 50: continue
                current = float(df.iloc[-1])
                dma50 = float(df.tail(50).mean())
                total += 1
                if current > dma50: advancing += 1
            except Exception:
                continue

        print(json.dumps({
            "nifty_candles": candles,
            "breadth": {"advancing": advancing, "total": total, "pct": (advancing / total * 100) if total > 0 else 50.0},
        }, default=str))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


def _lookup_csv(symbol: str) -> dict:
    """Look up sector + longName + market cap from Nifty 750 CSV."""
    try:
        csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "nifty750.csv")
        if not os.path.exists(csv_path):
            return {}
        df = pd.read_csv(csv_path)
        match = df[df["Symbol"].str.upper() == symbol.upper()]
        if len(match) == 0:
            match = df[df["Symbol"].str.upper().str.replace("-", "").str.replace(".NS", "") == symbol.upper().replace("-", "")]
        if len(match) > 0:
            row = match.iloc[0]
            return {
                "longName": str(row.get("Company Name", row.get("Name", symbol))),
                "sector": str(row.get("Sector", "—")),
                "industry": str(row.get("Industry", "—")),
                "marketCapCr": float(str(row.get("Market Cap (Rs. Cr.)", row.get("MarketCap", 0))).replace("?", "").replace(",", "") or 0),
            }
    except Exception:
        pass
    return {}


def _fuzzy_match_csv(query: str, limit: int = 5) -> list:
    """Fuzzy-match a query against Nifty 750 CSV Symbol + Company Name."""
    try:
        csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "nifty750.csv")
        if not os.path.exists(csv_path):
            return []
        df = pd.read_csv(csv_path)
        query_upper = query.upper().replace(" ", "").replace("-", "").replace("&", "")
        candidates = []
        for _, row in df.iterrows():
            sym = str(row.get("Symbol", "")).upper()
            name = str(row.get("Company Name", "")).upper().replace(" ", "").replace("-", "").replace("&", "").replace("LTD", "").replace("LIMITED", "")
            score = 0
            if sym == query_upper:
                score = 1000
            elif sym.startswith(query_upper):
                score = 500 + (10 - min(10, len(sym) - len(query_upper)))
            elif query_upper in sym:
                score = 300 + (10 - min(10, len(sym) - len(query_upper)))
            elif sym in query_upper:
                score = 250
            elif name.startswith(query_upper):
                score = 200
            elif query_upper in name:
                score = 100
            elif len(query_upper) >= 3 and query_upper[:3] in sym:
                score = 50
            elif len(query_upper) >= 3 and query_upper[:3] in name:
                score = 30
            if score > 0:
                candidates.append((score, row))
        candidates.sort(key=lambda x: -x[0])
        return [{
            "symbol": str(r.get("Symbol", "")),
            "name": str(r.get("Company Name", "")),
            "sector": str(r.get("Industry", "—")),
            "marketCapCr": float(str(r.get("Market Capital (? Cr)", "0")).replace("?", "").replace(",", "") or 0),
            "closePrice": float(str(r.get("Close Price as of 05-Oct-2026", "0")).replace("?", "").replace(",", "") or 0),
        } for _, r in candidates[:limit]]
    except Exception:
        return []


def _compute_ema(values, period):
    """Compute EMA for a pandas Series."""
    return values.ewm(span=period, adjust=False).mean()


def _compute_rsi_from_closes(closes, period=14):
    """Compute RSI from a pandas Series of closes."""
    delta = closes.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1.0/period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0/period, adjust=False).mean().replace(0.0, np.nan)
    rs = avg_gain / avg_loss
    rsi = (100.0 - 100.0 / (1.0 + rs)).iloc[-1]
    return float(rsi) if np.isfinite(rsi) else 50.0


def _find_swing_low(close, lookback=10):
    """Find the most recent daily swing low (lowest low in last N days, excluding today)."""
    if len(close) < 2:
        return None
    recent = close.iloc[-(lookback + 1):-1]
    if len(recent) == 0:
        return None
    return float(recent.min())


def _find_prev_week_low(weekly_close):
    """Find the low of the previous completed week."""
    if len(weekly_close) < 2:
        return None
    return float(weekly_close.iloc[-2])


def _compute_pullback_bridge(df):
    """Compute the Pullback Bridge framework data.
    Returns dict with:
      - monthly_rsi: RSI on monthly timeframe
      - macro_filter_pass: bool (monthly RSI 60-72)
      - daily_20ema: Daily 20 EMA value
      - weekly_9ema: Weekly 9 EMA value
      - anchor_candle: {date, high, volume, close, open} — highest-vol green candle of current month
      - anchor_break_price: anchor high + ₹2
      - month_range_low, month_range_high, month_range_50pct: current month's range + 50% retracement
      - swing_low: recent daily swing low (10-day)
      - prev_week_low: previous week's low
      - entry_tactics: list of 3 tactics with entry/stop/risk
    """
    try:
        close = df["Close"].squeeze().dropna()
        volume = df["Volume"].squeeze().dropna() if "Volume" in df.columns else None
        open_col = df["Open"].squeeze().dropna() if "Open" in df.columns else None

        if len(close) < 60:
            return None

        # --- Monthly RSI (need at least 15 monthly candles for RSI(14)) ---
        monthly_close = close.resample("ME").last().dropna()
        monthly_rsi = _compute_rsi_from_closes(monthly_close) if len(monthly_close) >= 15 else 50.0
        macro_filter_pass = 60 <= monthly_rsi <= 72

        # --- Daily 20 EMA ---
        daily_20ema = float(_compute_ema(close, 20).iloc[-1]) if len(close) >= 20 else None

        # --- Weekly 9 EMA ---
        weekly_close = close.resample("W-FRI").last().dropna()
        weekly_9ema = float(_compute_ema(weekly_close, 9).iloc[-1]) if len(weekly_close) >= 9 else None

        # --- Anchor Candle: highest-volume green candle of current month ---
        # Identify current month
        current_month = close.index[-1].to_period("M")
        # Filter to current month's candles
        month_mask = close.index.to_period("M") == current_month
        month_closes = close[month_mask]
        anchor_candle = None
        anchor_break_price = None
        if volume is not None and open_col is not None and len(month_closes) > 0:
            month_vols = volume[month_mask]
            month_opens = open_col[month_mask]
            # Green candles: close > open
            green_mask = month_closes > month_opens
            if green_mask.any():
                green_closes = month_closes[green_mask]
                green_vols = month_vols[green_mask]
                green_opens = month_opens[green_mask]
                # Also need the highs of green candles
                month_highs = df["High"].squeeze()[month_mask][green_mask]
                green_lows = df["Low"].squeeze()[month_mask][green_mask]
                if len(green_vols) > 0:
                    anchor_idx = green_vols.idxmax()
                    anchor_candle = {
                        "date": anchor_idx.strftime("%Y-%m-%d"),
                        "open": float(month_opens[anchor_idx]),
                        "high": float(month_highs[anchor_idx]),
                        "low": float(green_lows[anchor_idx]),
                        "close": float(month_closes[anchor_idx]),
                        "volume": float(green_vols[anchor_idx]),
                    }
                    anchor_break_price = anchor_candle["high"] + 2.0  # ₹2 above high

        # --- Monthly Range + 50% Retracement ---
        month_range_high = float(month_closes.max()) if len(month_closes) > 0 else None
        # Use intrmonth high (not just close) for range
        if "High" in df.columns and "Low" in df.columns:
            month_highs_all = df["High"].squeeze()[month_mask]
            month_lows_all = df["Low"].squeeze()[month_mask]
            month_range_high = float(month_highs_all.max()) if len(month_highs_all) > 0 else month_range_high
            month_range_low = float(month_lows_all.min()) if len(month_lows_all) > 0 else None
        else:
            month_range_low = float(month_closes.min()) if len(month_closes) > 0 else None
        month_range_50pct = None
        if month_range_high is not None and month_range_low is not None and month_range_high > 0:
            month_range_50pct = month_range_low + (month_range_high - month_range_low) * 0.5

        # --- Swing Low (10-day, excluding today) ---
        swing_low = _find_swing_low(close, lookback=10)

        # --- Previous Week Low ---
        prev_week_low = _find_prev_week_low(weekly_close)

        # --- Build 3 entry tactics ---
        current_price = float(close.iloc[-1])
        tactics = []

        # Tactic 1: Daily 20 EMA Touchdown
        if daily_20ema is not None:
            t1_entry = daily_20ema
            t1_stop = swing_low if swing_low else t1_entry * 0.97
            t1_risk = t1_entry - t1_stop
            tactics.append({
                "id": "ema_touchdown",
                "name": "Daily 20 EMA Touchdown",
                "subtitle": "The Safest Route",
                "entry": t1_entry,
                "stop": t1_stop,
                "risk_pct": (t1_risk / t1_entry * 100) if t1_entry > 0 else 0,
                "description": "Wait for pullback to Daily 20 EMA. Enter on first green candle bouncing off it.",
                "status": "WAIT" if current_price > daily_20ema * 1.02 else "READY",
            })

        # Tactic 2: Anchor Candle High Break
        if anchor_candle is not None and anchor_break_price is not None:
            t2_entry = anchor_break_price
            t2_stop = anchor_candle["low"]
            t2_risk = t2_entry - t2_stop
            tactics.append({
                "id": "anchor_break",
                "name": "Anchor Candle High Break",
                "subtitle": "The Momentum Route",
                "entry": t2_entry,
                "stop": t2_stop,
                "risk_pct": (t2_risk / t2_entry * 100) if t2_entry > 0 else 0,
                "description": f"Buy-limit ₹2 above the high of the highest-volume green candle ({anchor_candle['date']}).",
                "status": "TRIGGERED" if current_price >= anchor_break_price else "PENDING",
            })

        # Tactic 3: 50% Monthly Range Retracement
        if month_range_50pct is not None:
            t3_entry = month_range_50pct
            t3_stop = month_range_low if month_range_low else t3_entry * 0.97
            t3_risk = t3_entry - t3_stop
            tactics.append({
                "id": "range_50pct",
                "name": "50% Monthly Range Retracement",
                "subtitle": "The Mathematical Value Route",
                "entry": t3_entry,
                "stop": t3_stop,
                "risk_pct": (t3_risk / t3_entry * 100) if t3_entry > 0 else 0,
                "description": f"Limit order at 50% of this month's range ({month_range_low:.0f}–{month_range_high:.0f}).",
                "status": "WAIT" if current_price > month_range_50pct * 1.02 else "READY",
            })

        return {
            "monthly_rsi": float(monthly_rsi),
            "macro_filter_pass": macro_filter_pass,
            "daily_20ema": daily_20ema,
            "weekly_9ema": weekly_9ema,
            "anchor_candle": anchor_candle,
            "anchor_break_price": anchor_break_price,
            "month_range_low": month_range_low,
            "month_range_high": month_range_high,
            "month_range_50pct": month_range_50pct,
            "swing_low": swing_low,
            "prev_week_low": prev_week_low,
            "entry_tactics": tactics,
        }
    except Exception as e:
        return {"error": str(e)}


def cmd_analyze(symbol: str):
    """Analyze a single stock — full indicators + setup + signal + trade plan + Pullback Bridge."""
    try:
        sym_clean = symbol.upper().replace(".NS", "").strip()
        if not sym_clean:
            print(json.dumps({"error": "Symbol is required"}))
            return

        ticker = f"{sym_clean}.NS"
        # Fetch 1Y for indicators (220+ days needed for 200DMA)
        df = yf.download(ticker, period="1y", interval="1d", progress=False, threads=False)
        if df is None or len(df) < 220:
            suggestions = _fuzzy_match_csv(sym_clean, limit=5)
            print(json.dumps({
                "error": f"Could not fetch data for {sym_clean} (got {0 if df is None else len(df)} rows). This usually means the symbol doesn't exist on NSE or has insufficient history.",
                "query": sym_clean,
                "suggestions": suggestions,
            }))
            return

        m = compute_metrics(sym_clean, df)
        if m is None:
            print(json.dumps({"error": f"Could not compute indicators for {sym_clean}"}))
            return

        # Fetch 2Y for Pullback Bridge (need 15+ monthly candles for monthly RSI)
        df_2y = yf.download(ticker, period="2y", interval="1d", progress=False, threads=False)
        pullback_bridge = _compute_pullback_bridge(df_2y if df_2y is not None and len(df_2y) > 300 else df)

        csv_info = _lookup_csv(sym_clean)
        result = {**m, **{
            "symbol": sym_clean,
            "longName": csv_info.get("longName", sym_clean),
            "sector": csv_info.get("sector", "—"),
            "industry": csv_info.get("industry", "—"),
            "marketCapCr": csv_info.get("marketCapCr", 0),
            "pullbackBridge": pullback_bridge,
        }}
        print(json.dumps(result, default=str))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "screen"
    if cmd == "screen":
        # Optional second argument: top_n (default 10)
        top_n = 10
        if len(sys.argv) > 2:
            try:
                top_n = max(1, min(50, int(sys.argv[2])))  # clamp 1-50
            except ValueError:
                pass
        # Optional third argument: filters JSON
        filters = None
        if len(sys.argv) > 3:
            try:
                filters = json.loads(sys.argv[3])
            except (json.JSONDecodeError, ValueError):
                pass
        cmd_screen(top_n=top_n, filters=filters)
    elif cmd == "stops":
        payload = json.loads(sys.argv[2])
        cmd_stops(payload)
    elif cmd == "nifty":
        cmd_nifty()
    elif cmd == "bridge_screen":
        top_n = 10
        if len(sys.argv) > 2:
            try:
                top_n = max(1, min(50, int(sys.argv[2])))
            except ValueError:
                pass
        filters = None
        if len(sys.argv) > 3:
            try:
                filters = json.loads(sys.argv[3])
            except (json.JSONDecodeError, ValueError):
                pass
        cmd_bridge_screen(top_n=top_n, filters=filters)
    elif cmd == "analyze":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "analyze needs a symbol argument"}))
        else:
            cmd_analyze(sys.argv[2])
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))
        sys.exit(1)
