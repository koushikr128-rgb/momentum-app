// Market Regime API — multi-source fallback chain:
// 1. Python yfinance (PRIMARY — bypasses Yahoo TLS fingerprinting)
// 2. Kite historical (if token present + has permission)
// 3. Yahoo direct (single quick try)
// 4. Kite OHLC quote (degraded — live price only)
// 5. Stale cache (30 min)
// 6. Graceful fallback (CHOP / 0.5)

import { NextResponse } from "next/server";
import { batchFetchDailyCandles } from "@/lib/yahoo";
import { computeMetrics } from "@/lib/indicators";
import { classifyRegime, RegimeState, MarketRegime } from "@/lib/regime";
import { fetchHistoricalData, fetchOHLCQuote } from "@/lib/kite";
import type { Candle } from "@/lib/yahoo";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

const RENDER_URL = process.env.RENDER_URL || "";
const IS_SANDBOX = !RENDER_URL && process.env.VERCEL !== "1";

async function fetchNiftyViaPython(): Promise<{
  candles: Candle[];
  breadth: { advancing: number; total: number };
} | null> {
  // 1. Try Render backend (Vercel deployment)
  if (RENDER_URL) {
    try {
      const res = await fetch(`${RENDER_URL}/nifty`, {
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.nifty_candles && data.nifty_candles.length >= 220) {
          return {
            candles: data.nifty_candles as Candle[],
            breadth: {
              advancing: data.breadth?.advancing || 0,
              total: data.breadth?.total || 0,
            },
          };
        }
      }
    } catch (e: any) {
      console.error("[regime] Render fetch failed:", e.message);
    }
    return null;
  }

  // 2. Local Python (sandbox only)
  if (!IS_SANDBOX) return null;
  try {
    const scriptPath = path.join(process.cwd(), "scripts", "yfinance_backend.py");
    const { stdout, stderr } = await execAsync(`python3 ${scriptPath} nifty`, {
      timeout: 25000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: "/home/z/my-project/pylibs" },
    });
    if (stderr) console.error("[regime] Python stderr:", stderr.slice(0, 200));
    const data = JSON.parse(stdout);
    if (data.error || !data.nifty_candles || data.nifty_candles.length < 220) {
      console.error("[regime] Python nifty failed:", data.error || "insufficient candles");
      return null;
    }
    return {
      candles: data.nifty_candles as Candle[],
      breadth: {
        advancing: data.breadth?.advancing || 0,
        total: data.breadth?.total || 0,
      },
    };
  } catch (e: any) {
    console.error("[regime] Python exec failed:", e.message);
    return null;
  }
}

async function fetchNiftyViaKite(accessToken: string): Promise<Candle[] | null> {
  try {
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    const fromDate = oneYearAgo.toISOString().slice(0, 10);
    const toDate = today.toISOString().slice(0, 10);
    const candles = await fetchHistoricalData(accessToken, 256265, fromDate, toDate);
    if (!candles || candles.length < 220) return null;
    return candles.map((c) => ({
      timestamp: Math.floor(new Date(c.date).getTime() / 1000),
      open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    }));
  } catch (e: any) {
    console.error("[regime] Kite NIFTY fetch failed:", e.message);
    return null;
  }
}

async function fetchNiftyViaYahoo(): Promise<Candle[] | null> {
  try {
    const m = await batchFetchDailyCandles(["^NSEI"], "1y", 1);
    const d = m.get("^NSEI");
    if (d && d.candles.length >= 220) return d.candles;
  } catch (e: any) {
    console.error("[regime] Yahoo fetch failed:", e.message);
  }
  return null;
}

async function computeBreadthViaYahoo(): Promise<{ advancing: number; total: number }> {
  const BREADTH_SAMPLE = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
    "ITC", "SBIN", "LT", "BHARTIARTL", "KOTAKBANK", "AXISBANK",
    "ASIANPAINT", "MARUTI", "SUNPHARMA", "TITAN", "ULTRACEMCO", "NESTLEIND", "WIPRO",
    "ONGC", "NTPC", "POWERGRID", "TATAMOTORS", "TATASTEEL", "JSWSTEEL", "HCLTECH",
    "BAJFINANCE", "TECHM", "GRASIM", "COALINDIA", "DRREDDY", "CIPLA", "DIVISLAB",
    "HDFCLIFE", "SBILIFE", "BRITANNIA", "EICHERMOT", "ADANIENT", "ADANIPORTS",
    "BPCL", "IOC", "TATACONSUM", "HEROMOTOCO", "BAJAJFINSV",
    "INDUSINDBK", "BAJAJ-AUTO", "SHRIRAMFIN",
  ];
  const breadthSymbols = BREADTH_SAMPLE.map((s) => `${s}.NS`);
  const breadthMap = await batchFetchDailyCandles(breadthSymbols, "3mo", 2);
  let advancing = 0;
  let total = 0;
  for (const [sym, data] of breadthMap.entries()) {
    if (!data || data.candles.length < 60) continue;
    const m = computeMetrics(sym, data.candles);
    if (!m) continue;
    total++;
    if (m.currentPrice > m.dma50) advancing++;
  }
  return { advancing, total };
}

let cachedRegime: { state: RegimeState; at: number } | null = null;
const FRESH_TTL_MS = 5 * 60 * 1000;
const STALE_TTL_MS = 30 * 60 * 1000;
let lastRegime: MarketRegime | null = null;
let regimeHistory: MarketRegime[] = [];

export async function GET(req: Request) {
  try {
    if (cachedRegime && Date.now() - cachedRegime.at < FRESH_TTL_MS) {
      return NextResponse.json(cachedRegime.state);
    }

    const cookieHeader = req.headers.get("cookie") || "";
    let accessToken = cookieHeader.match(/kite_access_token=([^;]+)/)?.[1] || "";
    if (!accessToken) {
      accessToken = req.headers.get("x-kite-token") || "";
    }

    let niftyCandles: Candle[] | null = null;
    let dataSource: "python" | "kite" | "yahoo" | "stale" = "stale";
    let kiteError: string | null = null;
    let breadth = { advancing: 0, total: 0 };

    // Source 1: Python yfinance (PRIMARY)
    const pyResult = await fetchNiftyViaPython();
    if (pyResult) {
      niftyCandles = pyResult.candles;
      breadth = pyResult.breadth;
      dataSource = "python";
    }

    // Source 2: Kite historical
    if (!niftyCandles && accessToken) {
      niftyCandles = await fetchNiftyViaKite(accessToken);
      if (niftyCandles) {
        dataSource = "kite";
      } else {
        kiteError = "Kite historical fetch failed (insufficient permission or token expired)";
      }
    }

    // Source 3: Yahoo direct
    if (!niftyCandles) {
      niftyCandles = await fetchNiftyViaYahoo();
      if (niftyCandles) dataSource = "yahoo";
    }

    // Source 4: Kite OHLC quote (degraded)
    if (!niftyCandles && accessToken) {
      try {
        const ohlc = await fetchOHLCQuote(accessToken, "NSE:NIFTY 50");
        if (ohlc && ohlc.last_price > 0) {
          const changePct = ohlc.previous_close > 0
            ? (ohlc.last_price / ohlc.previous_close - 1) * 100 : 0;
          let degradedRegime: MarketRegime = "CHOP";
          if (changePct > 0.7) degradedRegime = "RISK-ON";
          else if (changePct < -0.7) degradedRegime = "RISK-OFF";

          const degradedState: RegimeState = {
            regime: degradedRegime,
            sizeMultiplier: degradedRegime === "RISK-ON" ? 0.75 : degradedRegime === "RISK-OFF" ? 0.35 : 0.5,
            niftyClose: ohlc.last_price,
            niftyChangePct: changePct,
            niftyAbove50dma: changePct > 0,
            niftyAbove200dma: changePct > 0,
            nifty50dma: ohlc.previous_close,
            nifty200dma: ohlc.previous_close,
            breadthPct: 50,
            breadthAdvancing: 0,
            breadthTotal: 0,
            volatilityPct: 0,
            description: `Live NIFTY: ${changePct.toFixed(2)}% today (degraded — historical data unavailable)`,
            recommendation: degradedRegime === "RISK-ON"
              ? "Market up strongly today — lean long but verify with full regime later"
              : degradedRegime === "RISK-OFF"
                ? "Market down strongly today — defensive posture, reduce sizes"
                : "Market choppy today — selective deployment only",
            flippedSessionsAgo: 0,
            previousRegime: lastRegime,
            asOf: new Date().toISOString(),
          };
          (degradedState as any).dataSource = "kite_ohlc";
          (degradedState as any).degraded = true;
          cachedRegime = { state: degradedState, at: Date.now() };
          return NextResponse.json(degradedState);
        }
      } catch (e: any) {
        console.error("[regime] Kite OHLC fallback failed:", e.message);
      }
    }

    // Source 5: Stale cache
    if (!niftyCandles) {
      if (cachedRegime && Date.now() - cachedRegime.at < STALE_TTL_MS) {
        const staleState = {
          ...cachedRegime.state,
          stale: true,
          description: `${cachedRegime.state.description} (cached — data sources unavailable)`,
        };
        return NextResponse.json(staleState);
      }
      const reason = !accessToken
        ? "Not connected to Zerodha and Python backend unavailable."
        : kiteError
          ? `${kiteError}. Reconnect Zerodha, then retry.`
          : "All data sources failed. Reconnect Zerodha or retry in a minute.";
      return NextResponse.json({
        error: reason,
        regime: "CHOP",
        sizeMultiplier: 0.5,
        niftyClose: 0,
        niftyChangePct: 0,
        niftyAbove50dma: false,
        niftyAbove200dma: false,
        nifty50dma: 0,
        nifty200dma: 0,
        breadthPct: 50,
        breadthAdvancing: 0,
        breadthTotal: 0,
        volatilityPct: 0,
        description: "Data unavailable — defaulting to CHOP / 50% size as a safety posture",
        recommendation: reason,
        flippedSessionsAgo: 0,
        previousRegime: null,
        asOf: new Date().toISOString(),
      }, { status: 200 });
    }

    // Fetch breadth if still 0
    if (breadth.total === 0) {
      try {
        breadth = await computeBreadthViaYahoo();
      } catch (e: any) {
        console.error("[regime] Breadth fetch failed:", e.message);
      }
    }

    const state = classifyRegime(niftyCandles, breadth.advancing, breadth.total, lastRegime, regimeHistory);
    if (!state) {
      return NextResponse.json(
        { error: "Could not classify regime", regime: "CHOP", sizeMultiplier: 0.5 },
        { status: 500 }
      );
    }

    (state as any).dataSource = dataSource;

    if (state.regime !== lastRegime) {
      regimeHistory.push(state.regime);
      if (regimeHistory.length > 30) regimeHistory = regimeHistory.slice(-30);
      lastRegime = state.regime;
    }

    cachedRegime = { state, at: Date.now() };
    return NextResponse.json(state);
  } catch (e: any) {
    console.error("[regime] Error:", e.message);
    if (cachedRegime && Date.now() - cachedRegime.at < STALE_TTL_MS) {
      return NextResponse.json({ ...cachedRegime.state, stale: true });
    }
    return NextResponse.json(
      { error: e.message || "Unknown error", regime: "CHOP", sizeMultiplier: 0.5 },
      { status: 200 }
    );
  }
}
