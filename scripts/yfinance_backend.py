"""
Backend script called by Next.js API routes.
Outputs JSON to stdout.

Usage:
  python3 yfinance_backend.py screen
  python3 yfinance_backend.py stops TICKER1,TICKER2,ENTRY1,ENTRY2,...
"""
import sys, json, time
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
    # Momentum score (0-100) — weighted blend of returns + RSI + Sharpe
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

    return {
        "symbol": symbol,
        "lastDate": close.index[-1].strftime("%Y-%m-%d"),
        "currentPrice": current,
        "dma50": dma50,
        "dma200": dma200,
        "rsi14": float(rsi),
        "avgVolume30d": avg_vol,
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
    out.sort(key=lambda x: x["ret6mPct"], reverse=True)
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
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))
        sys.exit(1)
