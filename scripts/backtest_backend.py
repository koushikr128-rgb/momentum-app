"""
Backtest engine for Nifty Momentum Strategy
============================================
Downloads 3 years of OHLCV for the universe + Nifty 50 benchmark,
runs monthly rebalance for the last 2 years, returns JSON with:
  - equity curve (strategy vs Nifty 50)
  - monthly returns
  - summary stats: CAGR, hit rate, max DD, avg winner, avg loser, Sharpe
  - recent picks history (last 6 rebalances)

Usage:
  python3 backtest_backend.py
"""
from __future__ import annotations
import sys, json, time
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
import yfinance as yf

# Re-use the same universe as the live screen
from yfinance_backend import UNIVERSE

BENCHMARK = "^NSEI"  # Nifty 50
HOLDING_PERIOD_DAYS = 22   # ~1 trading month
BACKTEST_PERIOD_DAYS = 504 # ~2 years of trading days
LOOKBACK_DAYS = 220         # need 200 DMA
TOTAL_HISTORY_DAYS = BACKTEST_PERIOD_DAYS + LOOKBACK_DAYS + 50  # buffer

# Download once (this takes ~30-45s)
def download_all():
    print("Downloading 3y OHLCV for universe + Nifty 50...", file=sys.stderr)
    tickers = [f"{s}.NS" for s in UNIVERSE] + [BENCHMARK]
    raw = yf.download(tickers, period="3y", group_by="ticker",
                     threads=True, progress=False, auto_adjust=False)
    return raw

def compute_indicators_at_date(candles_df, as_of_idx):
    """Compute indicators using data up to as_of_idx (exclusive of future)."""
    if as_of_idx < 220:
        return None
    sub = candles_df.iloc[:as_of_idx + 1]
    close = sub["Close"].squeeze().dropna()
    volume = sub["Volume"].squeeze().dropna()
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
    if len(close) <= 126:
        return None
    ret_6m = (current / float(close.iloc[-127]) - 1.0) * 100.0

    daily_ret = close.pct_change().dropna().tail(126)
    if len(daily_ret) > 20:
        vol_d = float(daily_ret.std(ddof=1))
        ann_vol = vol_d * np.sqrt(252) * 100
    else:
        ann_vol = 30.0
    return {
        "current": current,
        "dma50": dma50,
        "dma200": dma200,
        "rsi": float(rsi),
        "avg_vol": avg_vol,
        "ret_6m": ret_6m,
        "ann_vol": ann_vol,
    }

def passes_filters(m):
    return (
        m["current"] > m["dma200"]
        and m["current"] > m["dma50"]
        and m["dma50"] > m["dma200"]
        and m["rsi"] > 55
        and m["avg_vol"] > 50_000
    )

def run_backtest():
    raw = download_all()

    # Get benchmark close series
    bench_df = raw[BENCHMARK]
    bench_close = bench_df["Close"]
    if not isinstance(bench_close, pd.Series):
        bench_close = pd.Series([float(bench_close)], index=[bench_df.index[0]])
    bench_close = bench_close.dropna()
    # Build a single date index from benchmark (it's the most liquid)
    all_dates = bench_close.index.tolist()
    if len(all_dates) < BACKTEST_PERIOD_DAYS + LOOKBACK_DAYS:
        return {"error": f"Insufficient history: only {len(all_dates)} days"}

    # Pre-extract per-stock close series for fast lookup
    stock_data = {}  # symbol -> {close: pd.Series, volume: pd.Series}
    for sym in UNIVERSE:
        tk = f"{sym}.NS"
        try:
            if isinstance(raw.columns, pd.MultiIndex) and tk in raw.columns.get_level_values(0):
                df = raw[tk].dropna(subset=["Close"])
                # Always coerce to Series (yfinance returns scalar for single-ticker calls)
                close_s = df["Close"]
                vol_s = df["Volume"]
                if not isinstance(close_s, pd.Series):
                    close_s = pd.Series([float(close_s)], index=[df.index[0]])
                if not isinstance(vol_s, pd.Series):
                    vol_s = pd.Series([float(vol_s)], index=[df.index[0]])
                stock_data[sym] = {
                    "close": close_s,
                    "volume": vol_s,
                }
        except Exception:
            continue

    print(f"Loaded {len(stock_data)} stocks with data", file=sys.stderr)

    # Rebalance dates: pick every ~22 trading days over the backtest period
    start_idx = len(all_dates) - BACKTEST_PERIOD_DAYS
    rebalance_indices = list(range(start_idx, len(all_dates), HOLDING_PERIOD_DAYS))
    print(f"Running {len(rebalance_indices)} rebalances", file=sys.stderr)

    # Track equity curve and monthly returns
    equity_curve = []
    benchmark_curve = []
    monthly_returns = []  # list of {month, strategy_ret, benchmark_ret, picks}
    picks_history = []
    win_count = 0
    loss_count = 0
    winner_returns = []
    loser_returns = []

    initial_capital = 100.0  # normalized to 100
    strategy_value = initial_capital
    benchmark_value = initial_capital
    prev_strategy_value = initial_capital

    for r_i, rb_idx in enumerate(rebalance_indices):
        # At each rebalance, compute indicators for all stocks using data up to rb_idx
        # Filter + rank → Top 10
        candidates = []
        for sym, sd in stock_data.items():
            # Slice close + volume up to rb_idx
            close_sub = sd["close"].iloc[:rb_idx + 1]
            volume_sub = sd["volume"].iloc[:rb_idx + 1]
            if len(close_sub) < 220:
                continue
            m = compute_indicators_at_date(
                pd.DataFrame({"Close": close_sub, "Volume": volume_sub}),
                len(close_sub) - 1
            )
            if m is None or not passes_filters(m):
                continue
            candidates.append({
                "symbol": sym,
                "current": m["current"],
                "rsi": m["rsi"],
                "ret_6m": m["ret_6m"],
                "ann_vol": m["ann_vol"],
            })

        candidates.sort(key=lambda x: x["ret_6m"], reverse=True)
        top10 = candidates[:10]

        if not top10:
            # No picks this month — keep capital in cash
            next_idx = min(rb_idx + HOLDING_PERIOD_DAYS, len(all_dates) - 1)
            rb_date = all_dates[rb_idx]
            next_date = all_dates[next_idx]
            strat_ret = 0.0
            bench_ret = (bench_close.iloc[next_idx] / bench_close.iloc[rb_idx] - 1) * 100
            strategy_value = strategy_value  # unchanged
            benchmark_value = benchmark_value * (1 + bench_ret / 100)
        else:
            # Equal weight (simple backtest — no inverse-vol optimization for speed)
            weight = 1.0 / len(top10)
            next_idx = min(rb_idx + HOLDING_PERIOD_DAYS, len(all_dates) - 1)
            rb_date = all_dates[rb_idx]
            next_date = all_dates[next_idx]
            port_ret = 0.0
            for c in top10:
                sd = stock_data[c["symbol"]]
                entry = sd["close"].iloc[rb_idx]
                exit_p = sd["close"].iloc[next_idx]
                if entry > 0 and exit_p > 0:
                    r = exit_p / entry - 1
                    port_ret += weight * r
            strat_ret = port_ret * 100
            bench_ret = (bench_close.iloc[next_idx] / bench_close.iloc[rb_idx] - 1) * 100
            strategy_value = strategy_value * (1 + strat_ret / 100)
            benchmark_value = benchmark_value * (1 + bench_ret / 100)

            # Track winners/losers
            for c in top10:
                sd = stock_data[c["symbol"]]
                entry = sd["close"].iloc[rb_idx]
                exit_p = sd["close"].iloc[next_idx]
                if entry > 0 and exit_p > 0:
                    r = (exit_p / entry - 1) * 100
                    if r > 0:
                        win_count += 1
                        winner_returns.append(r)
                    else:
                        loss_count += 1
                        loser_returns.append(r)

            picks_history.append({
                "date": rb_date.strftime("%Y-%m-%d"),
                "picks": [c["symbol"] for c in top10],
                "strategy_ret": round(strat_ret, 2),
                "benchmark_ret": round(bench_ret, 2),
            })

        equity_curve.append({
            "date": next_date.strftime("%Y-%m-%d"),
            "strategy": round(strategy_value, 2),
            "benchmark": round(benchmark_value, 2),
        })
        monthly_returns.append({
            "month": rb_date.strftime("%b %Y"),
            "strategy_ret": round(strat_ret, 2),
            "benchmark_ret": round(bench_ret, 2),
        })
        prev_strategy_value = strategy_value

    # Compute summary stats
    n_months = len(monthly_returns)
    if n_months == 0:
        return {"error": "No rebalances computed"}

    final_strategy = strategy_value
    final_benchmark = benchmark_value
    total_strategy_ret = (final_strategy / initial_capital - 1) * 100
    total_benchmark_ret = (final_benchmark / initial_capital - 1) * 100

    # Annualized (assuming 2 years)
    years = n_months / 12
    if years > 0 and final_strategy > 0:
        cagr_strategy = (final_strategy / initial_capital) ** (1 / years) - 1
    else:
        cagr_strategy = 0
    if years > 0 and final_benchmark > 0:
        cagr_benchmark = (final_benchmark / initial_capital) ** (1 / years) - 1
    else:
        cagr_benchmark = 0

    # Max drawdown
    eq_series = pd.Series([e["strategy"] for e in equity_curve])
    peak = eq_series.cummax()
    dd = (eq_series / peak - 1) * 100
    max_dd = float(dd.min())

    # Sharpe (monthly returns, annualized)
    monthly_strategy = pd.Series([m["strategy_ret"] for m in monthly_returns])
    if monthly_strategy.std() > 0:
        sharpe = (monthly_strategy.mean() / monthly_strategy.std()) * np.sqrt(12)
    else:
        sharpe = 0

    avg_winner = float(np.mean(winner_returns)) if winner_returns else 0
    avg_loser = float(np.mean(loser_returns)) if loser_returns else 0
    win_rate = (win_count / (win_count + loss_count) * 100) if (win_count + loss_count) > 0 else 0

    result = {
        "equity_curve": equity_curve,
        "monthly_returns": monthly_returns[-12:],  # last 12 months for display
        "summary": {
            "backtest_period": f"{equity_curve[0]['date']} to {equity_curve[-1]['date']}",
            "rebalances": n_months,
            "initial_capital": initial_capital,
            "final_strategy": round(final_strategy, 2),
            "final_benchmark": round(final_benchmark, 2),
            "total_strategy_ret_pct": round(total_strategy_ret, 2),
            "total_benchmark_ret_pct": round(total_benchmark_ret, 2),
            "cagr_strategy_pct": round(cagr_strategy * 100, 2),
            "cagr_benchmark_pct": round(cagr_benchmark * 100, 2),
            "max_drawdown_pct": round(max_dd, 2),
            "sharpe": round(float(sharpe), 2),
            "win_rate_pct": round(win_rate, 2),
            "winners": win_count,
            "losers": loss_count,
            "avg_winner_pct": round(avg_winner, 2),
            "avg_loser_pct": round(avg_loser, 2),
            "excess_return_pct": round(total_strategy_ret - total_benchmark_ret, 2),
        },
        "picks_history": picks_history[-6:],  # last 6 rebalances
        "run_at": datetime.utcnow().isoformat() + "Z",
    }
    print(json.dumps(result, default=str))

if __name__ == "__main__":
    run_backtest()
