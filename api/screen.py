# Vercel Python serverless function — Nifty Momentum Screen
# Deployed at: https://your-app.vercel.app/api/screen.py
# Uses yfinance (with curl_cffi) to bypass Yahoo's TLS fingerprint blocking

import json
import sys
import os
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
    # Curated mid + small cap additions
    "AARTIDRUGS", "AARTIPHARM", "BAYERCROP", "BLISSGVS", "FDC",
    "GLENMARKLIFE", "GRANULES", "NATCO", "NEULAND", "PANACEABIO",
    "SANOFI", "SHILPAMED", "STRIDES", "SUVEN", "THYROCARE",
    "WOCKPHARMA",
    "ACRYSIL", "ADVANTA", "AETHERIND", "APARINDS", "BALAJIAMINE",
    "BASF", "BHARATRAS", "BORORENEW", "DCMSHRIRAM", "EIDPARRY",
    "FINEORG", "GHCL", "GNFC", "GOCLCORP", "GRAPHITE", "GRAVITA",
    "GUJALKALI", "JINDALSAW", "NAVINFLUOR", "NOCIL", "ROSSARI",
    "SOLARINDS", "SOMANY", "SUDARSHCHEM", "TANLA", "TATVA", "VINATIORGA",
    "CARBORUNIV", "FIEMIND", "FORCEMOT", "GABRIEL", "JBM",
    "METROBRAND", "PRECISION", "RICOAUTO", "SUBROS", "SUNFLAG",
    "UNOMINDA", "VARROC", "WABCOIND", "WHEELS",
    "BANKINDIA", "CANFINHOME", "DCBBANK", "EQUITASBNK", "IDBI",
    "INDIANB", "KARURVYSYA", "PEERRE", "SOUTHINDIAN", "SUNDARMFIN",
    "BLUEDART", "CCL", "GILLETTE", "NILKAMAL", "PATANJALI",
    "VENKEYS", "VSTIND", "WIMPLAST",
    "DELTACORP", "DIXON", "GMRINFRA", "HERITGFOOD", "INOXWIND",
    "JKLAKSHMI", "KANSAINER", "KIRLOSBROS", "KIRLOSENG", "LAXMIMACH",
    "LODHA", "MAHABANK", "MEGH", "METROPOLIS", "MINDTREE",
    "OBEROIRLTY", "PAGEIND", "PHOENIX", "PRECAM", "PRINCEPIPE",
    "RAMCOCEM", "RELINFRA", "SCHAEFFLER", "SELANE", "SKFINDIA",
    "SOBHA", "SPICEJET", "TIMKEN", "TTKPRESTIG", "TTKHLTH", "WELENT",
    "BSE", "HAPPY", "LATENTVIEW", "MAPMYINDIA", "NYKAA",
    "PAYTM", "PBFINTECH", "POLICYBZR", "ZOMATO",
    "ADANIGREEN", "INDIGAS", "KEC", "OIL", "TPGPWR",
]
UNIVERSE = list(dict.fromkeys(UNIVERSE))


def compute_metrics(symbol, candles_df):
    """Compute all indicators from a daily OHLCV DataFrame."""
    if candles_df is None or len(candles_df) < 220:
        return None
    close = candles_df["Close"].squeeze().dropna() if isinstance(candles_df["Close"], pd.Series) else candles_df["Close"].iloc[:, 0].dropna()
    volume = candles_df["Volume"].squeeze().dropna() if isinstance(candles_df["Volume"], pd.Series) else candles_df["Volume"].iloc[:, 0].dropna()
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

    # Momentum score
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


def handler(request):
    """Vercel Python serverless function entry point."""
    try:
        # Parse query params
        from urllib.parse import parse_qs
        url = request.get("url", "") if isinstance(request, dict) else str(request)
        params = parse_qs(url.split("?")[1]) if "?" in url else {}
        top_n = max(1, min(50, int(params.get("topN", ["10"])[0])))
        rsi_min = float(params.get("rsiMin", ["50"])[0])
        mcap_min_cr = float(params.get("mcapMin", ["200"])[0])
        vol_min = float(params.get("volMin", ["20000"])[0])

        tickers = [f"{s}.NS" for s in UNIVERSE]
        raw = yf.download(tickers, period="1y", group_by="ticker",
                         threads=True, progress=False, auto_adjust=False)
        metrics = []
        for sym in UNIVERSE:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    if f"{sym}.NS" not in raw.columns.get_level_values(0):
                        continue
                    df = raw[f"{sym}.NS"].dropna(subset=["Close"])
                else:
                    df = raw.dropna(subset=["Close"])
                m = compute_metrics(sym, df)
                if m:
                    metrics.append(m)
            except Exception:
                continue

        passed_tech = [m for m in metrics
                       if m["currentPrice"] > m["dma200"]
                       and m["currentPrice"] > m["dma50"]
                       and m["dma50"] > m["dma200"]
                       and m["rsi14"] > rsi_min
                       and m["avgVolume30d"] > vol_min
                       and m["ret6mPct"] is not None]

        import time as _time
        out = []
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

        out = [s for s in out if s["marketCapCr"] > mcap_min_cr]
        out.sort(key=lambda x: x["ret6mPct"], reverse=True)
        out = out[:top_n]
        for i, s in enumerate(out):
            s["rank"] = i + 1

        result = {
            "universeSize": len(UNIVERSE),
            "passedData": len(metrics),
            "passedTech": len(passed_tech),
            "passedMc": len(out),
            "top10": out,
            "runAt": pd.Timestamp.now(tz="UTC").isoformat(),
        }
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(result, default=str),
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": str(e)}),
        }
