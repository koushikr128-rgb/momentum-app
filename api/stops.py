# Vercel Python serverless function — Stop-Loss Monitor
# Deployed at: https://your-app.vercel.app/api/stops.py

import json
import sys
import yfinance as yf
import pandas as pd
import numpy as np


def handler(request):
    """Vercel Python serverless function entry point."""
    try:
        body = request.get("body", "{}") if isinstance(request, dict) else "{}"
        payload = json.loads(body) if isinstance(body, str) else body
        allocation = payload.get("allocation", [])

        if not allocation or len(allocation) < 1:
            return {
                "statusCode": 400,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"error": "allocation[] is required"}),
            }

        symbols = [p["symbol"] for p in allocation]
        tickers = [f"{s}.NS" for s in symbols]
        raw = yf.download(tickers, period="6mo", interval="1d", group_by="ticker",
                         threads=True, progress=False, auto_adjust=False)

        results = []
        for p in allocation:
            sym = p["symbol"]
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    df = raw[f"{sym}.NS"].dropna(subset=["Close"])
                else:
                    df = raw.dropna(subset=["Close"])
            except Exception:
                continue
            close = df["Close"]
            if isinstance(close, pd.DataFrame):
                close = close.iloc[:, 0]
            close = close.dropna()
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
                    ((current - trend_stop) / current, "Near 50 DMA"),
                    ((current - hard_stop) / current, "Near hard stop"),
                    ((current - trailing) / current, "Near trailing stop"),
                ]
                for g, label in gaps:
                    if g < 0.02:
                        status = "WATCH"; reasons.append(f"{label} ({g*100:+.1f}%)")
            pnl_pct = (current / p["entryPrice"] - 1) * 100
            pnl_rupees = (current - p["entryPrice"]) * p["shares"]
            results.append({
                "symbol": sym,
                "sector": p.get("sector", "—"),
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

        total_pnl = sum(r["pnlRupees"] for r in results)
        total_invested = sum(r["rupees"] for r in results)
        result = {
            "stops": results,
            "totalPnl": total_pnl,
            "totalInvested": total_invested,
            "pnlPct": (total_pnl / total_invested) * 100 if total_invested > 0 else 0,
            "runAt": pd.Timestamp.now(tz="UTC").isoformat(),
            "statusCounts": {
                "HOLD": sum(1 for r in results if r["status"] == "HOLD"),
                "WATCH": sum(1 for r in results if r["status"] == "WATCH"),
                "EXIT": sum(1 for r in results if r["status"] == "EXIT"),
            },
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
