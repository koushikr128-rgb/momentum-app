"""
Backend script called by Next.js API routes.
Outputs JSON to stdout.

Usage:
  python3 yfinance_backend.py screen
  python3 yfinance_backend.py stops TICKER1,TICKER2,ENTRY1,ENTRY2,...
"""
import sys, json, time
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
]
UNIVERSE = list(dict.fromkeys(UNIVERSE))


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
    }


def cmd_screen():
    tickers = [f"{s}.NS" for s in UNIVERSE]
    raw = yf.download(tickers, period="18mo", group_by="ticker",
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
        except Exception:
            continue
        m = compute_metrics(sym, df)
        if m:
            metrics.append(m)
    # Technical + volume filter
    passed_tech = [m for m in metrics
                   if m["currentPrice"] > m["dma200"]
                   and m["currentPrice"] > m["dma50"]
                   and m["dma50"] > m["dma200"]
                   and m["rsi14"] > 55
                   and m["avgVolume30d"] > 50000
                   and m["ret6mPct"] is not None]
    # Fetch market cap + sector via .info
    out = []
    for m in passed_tech:
        try:
            t = yf.Ticker(f"{m['symbol']}.NS")
            info = t.info or {}
            mc = info.get("marketCap")
            if mc is None or mc / 1e7 <= 500:
                continue
            out.append({
                **m,
                "longName": info.get("longName") or info.get("shortName") or m["symbol"],
                "sector": info.get("sector") or "—",
                "industry": info.get("industry") or "—",
                "marketCapCr": float(mc) / 1e7,
            })
        except Exception:
            continue
    out.sort(key=lambda x: x["ret6mPct"], reverse=True)
    out = out[:10]
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
        cmd_screen()
    elif cmd == "stops":
        payload = json.loads(sys.argv[2])
        cmd_stops(payload)
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))
        sys.exit(1)
