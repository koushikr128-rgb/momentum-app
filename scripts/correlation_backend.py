"""
Correlation matrix backend
==========================
Reads JSON from stdin: {"symbols": ["RELIANCE", "TCS", ...]}
Fetches 6mo OHLCV for each symbol, computes pairwise correlation matrix.
Prints JSON to stdout.
"""
import sys, json
import yfinance as yf
import pandas as pd
import numpy as np


def main():
    payload = json.loads(sys.stdin.read())
    symbols = payload["symbols"]
    if len(symbols) < 2:
        print(json.dumps({"error": "Need at least 2 symbols", "matrix": [], "effectiveBets": 0, "symbols": [], "avgCorrelation": 0, "highCorrelationPairs": [], "nDataPoints": 0}))
        return

    tickers = [f"{s}.NS" for s in symbols]
    raw = yf.download(tickers, period="6mo", interval="1d", group_by="ticker",
                     threads=True, progress=False, auto_adjust=False)

    closes = {}
    for sym in symbols:
        tk = f"{sym}.NS"
        try:
            if isinstance(raw.columns, pd.MultiIndex):
                if tk in raw.columns.get_level_values(0):
                    c = raw[tk]["Close"]
                    if isinstance(c, pd.Series):
                        closes[sym] = c
            else:
                c = raw["Close"]
                if isinstance(c, pd.Series):
                    closes[sym] = c
        except Exception:
            continue

    df = pd.DataFrame(closes)
    df = df.dropna(how="all").ffill().dropna(how="all")

    if df.shape[1] < 2 or df.shape[0] < 20:
        print(json.dumps({"error": "Insufficient data", "matrix": [], "effectiveBets": 0, "symbols": [], "avgCorrelation": 0, "highCorrelationPairs": [], "nDataPoints": int(df.shape[0])}))
        return

    rets = df.pct_change().dropna()
    if rets.shape[0] < 20:
        print(json.dumps({"error": "Insufficient returns", "matrix": [], "effectiveBets": 0, "symbols": [], "avgCorrelation": 0, "highCorrelationPairs": [], "nDataPoints": int(rets.shape[0])}))
        return

    corr = rets.corr().fillna(0)
    ordered = list(corr.columns)
    w = np.array([1.0 / len(ordered)] * len(ordered))
    corr_arr = corr.loc[ordered, ordered].values
    numerator = float(w.sum() ** 2)
    denominator = float((np.outer(w, w) * corr_arr).sum())
    effective_bets = numerator / denominator if denominator > 0 else float(len(ordered))

    high_pairs = []
    for i in range(len(ordered)):
        for j in range(i + 1, len(ordered)):
            rho = float(corr_arr[i, j])
            if abs(rho) > 0.7:
                high_pairs.append({"a": ordered[i], "b": ordered[j], "rho": round(rho, 3)})

    off_diag = []
    for i in range(len(ordered)):
        for j in range(i + 1, len(ordered)):
            off_diag.append(float(corr_arr[i, j]))
    avg_corr = float(np.mean(off_diag)) if off_diag else 0.0

    matrix = [[""] + ordered]
    for i, sym_i in enumerate(ordered):
        row = [sym_i]
        for j in range(len(ordered)):
            row.append(round(float(corr_arr[i, j]), 2))
        matrix.append(row)

    print(json.dumps({
        "matrix": matrix,
        "symbols": ordered,
        "effectiveBets": round(effective_bets, 2),
        "avgCorrelation": round(avg_corr, 3),
        "highCorrelationPairs": high_pairs,
        "nDataPoints": int(rets.shape[0]),
    }))


if __name__ == "__main__":
    main()
