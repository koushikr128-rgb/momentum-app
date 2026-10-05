// GET /api/screen
// Hybrid: tries CSV-backed TypeScript first (fastest — no Yahoo .info calls),
// falls back to Vercel Python serverless function (when deployed on Vercel),
// falls back to local Python execFile (in sandbox),
// falls back to cache.

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { dedupUniverse } from "@/lib/universe";
import { batchFetchDailyCandles } from "@/lib/yahoo";
import { fetchBatchQuotes } from "@/lib/yahoo-batch";
import { computeMetrics, ScreenedStock } from "@/lib/indicators";
import { applyTechnicalFilter } from "@/lib/strategy";
import { getNifty750Symbols, getNifty750Map } from "@/lib/nifty750";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PYTHON = "/home/z/.venv/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/yfinance_backend.py";

// Detect if we're on Vercel (then Python functions are available at /api/screen.py)
const IS_VERCEL = process.env.VERCEL === "1" || !!process.env.VERCEL_URL;
// The Python serverless URL — on Vercel it's the same domain
const PYTHON_API_URL = IS_VERCEL ? "/api/screen.py" : null;

type CacheEntry = { data: unknown; ts: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;
let lastSuccessful: CacheEntry | null = null;

export async function GET(req: Request) {
  const start = Date.now();
  const url = new URL(req.url);
  const topN = Math.max(1, Math.min(50, Number(url.searchParams.get("topN") || "10")));
  const rsiMin = Number(url.searchParams.get("rsiMin") || "50");
  const mcapMin = Number(url.searchParams.get("mcapMin") || "200");
  const volMin = Number(url.searchParams.get("volMin") || "20000");

  const cacheKey = `${topN}-${rsiMin}-${mcapMin}-${volMin}`;
  const cached = cache.get(cacheKey);
  const cacheAge = cached ? Date.now() - cached.ts : Infinity;

  // 1. Fresh cache hit
  if (cached && cacheAge < CACHE_TTL_MS) {
    return NextResponse.json({
      ...(cached.data as object),
      cached: true, cacheAge,
      elapsedMs: Date.now() - start,
      topN, filters: { rsiMin, mcapMin, volMin },
    });
  }

  // 2. Try local Python first (uses CSV for market cap + yfinance for OHLCV — most reliable)
  const localPyResult = await tryLocalPython(topN, rsiMin, mcapMin, volMin, start);
  if (localPyResult) {
    cache.set(cacheKey, { data: localPyResult, ts: Date.now() });
    lastSuccessful = { data: localPyResult, ts: Date.now() };
    return NextResponse.json(localPyResult);
  }

  // 3. Try Vercel Python serverless function (works when deployed on Vercel)
  if (PYTHON_API_URL) {
    const pyResult = await tryVercelPython(topN, rsiMin, mcapMin, volMin, start);
    if (pyResult) {
      cache.set(cacheKey, { data: pyResult, ts: Date.now() });
      lastSuccessful = { data: pyResult, ts: Date.now() };
      return NextResponse.json(pyResult);
    }
  }

  // 4. Try CSV-backed TypeScript (fallback if Python unavailable)
  const csvResult = await tryCsvScreen(topN, rsiMin, mcapMin, volMin, start);
  if (csvResult) {
    cache.set(cacheKey, { data: csvResult, ts: Date.now() });
    lastSuccessful = { data: csvResult, ts: Date.now() };
    return NextResponse.json(csvResult);
  }

  // 5. Try pure TypeScript (works when Yahoo isn't rate-limiting)
  const tsResult = await tryTypeScript(topN, rsiMin, mcapMin, volMin, start);
  if (tsResult) {
    cache.set(cacheKey, { data: tsResult, ts: Date.now() });
    lastSuccessful = { data: tsResult, ts: Date.now() };
    return NextResponse.json(tsResult);
  }

  // 5. All failed — fall back to cache
  if (cached) {
    return NextResponse.json({
      ...(cached.data as object),
      cached: true, stale: true, cacheAge,
      elapsedMs: Date.now() - start,
      topN, filters: { rsiMin, mcapMin, volMin },
      warning: "All backends failed. Showing cached data.",
    });
  }
  if (lastSuccessful) {
    const lsData = lastSuccessful.data as Record<string, unknown>;
    const sliced = (lsData.top10 as unknown[]).slice(0, topN);
    return NextResponse.json({
      ...lsData, top10: sliced, topN,
      cached: true, stale: true, fallback: true,
      cacheAge: Date.now() - lastSuccessful.ts,
      elapsedMs: Date.now() - start,
      filters: { rsiMin, mcapMin, volMin },
      warning: "All backends failed. Showing fallback data.",
    });
  }

  // 6. No data at all
  return NextResponse.json({
    error: "Yahoo Finance rate-limited and no cache available.",
    warning: "Please try again in a few minutes.",
    universeSize: 0, passedData: 0, passedTech: 0, passedMc: 0, top10: [],
    runAt: new Date().toISOString(),
    elapsedMs: Date.now() - start, cached: false,
    topN, filters: { rsiMin, mcapMin, volMin },
  });
}

async function tryVercelPython(topN: number, rsiMin: number, mcapMin: number, volMin: number, start: number) {
  try {
    const params = new URLSearchParams({
      topN: String(topN), rsiMin: String(rsiMin),
      mcapMin: String(mcapMin), volMin: String(volMin),
    });
    const res = await fetch(`${PYTHON_API_URL}?${params}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !data.top10 || data.top10.length === 0) return null;
    return {
      ...data,
      elapsedMs: Date.now() - start,
      cached: false,
      topN,
      filters: { rsiMin, mcapMin, volMin },
      backend: "vercel-python",
    };
  } catch {
    return null;
  }
}

async function tryLocalPython(topN: number, rsiMin: number, mcapMin: number, volMin: number, start: number) {
  try {
    // Auto-install yfinance if missing (sandbox venv resets between sessions)
    const { stdout: checkOut } = await execFileAsync(
      PYTHON, ["-c", "import yfinance"],
      { timeout: 10_000 }
    ).catch(() => ({ stdout: "", stderr: "import failed" }));

    if (!checkOut && checkOut !== undefined) {
      // yfinance import failed — install it
      console.log("[screen] yfinance missing, auto-installing...");
      await execFileAsync(
        PYTHON, ["-m", "pip", "install", "yfinance", "pandas", "numpy", "--quiet"],
        { timeout: 120_000 }
      );
    }

    const filtersJson = JSON.stringify({ rsi_min: rsiMin, mcap_min_cr: mcapMin, vol_min: volMin });
    const { stdout } = await execFileAsync(
      PYTHON,
      [SCRIPT, "screen", String(topN), filtersJson],
      { timeout: 240_000, maxBuffer: 50 * 1024 * 1024 }
    );
    const lastLine = stdout.trim().split("\n").pop();
    if (!lastLine) return null;
    const data = JSON.parse(lastLine);
    if (data.error && (!data.top10 || data.top10.length === 0)) return null;
    return {
      ...data,
      elapsedMs: Date.now() - start,
      cached: false,
      topN,
      filters: { rsiMin, mcapMin, volMin },
      backend: "local-python",
    };
  } catch {
    return null;
  }
}

/**
 * CSV-backed screen — uses Nifty 750 CSV for universe + market cap + sector.
 * Only needs Yahoo for OHLCV (to compute RSI/MA/returns).
 * Eliminates the slow .info calls that caused rate-limiting.
 */
async function tryCsvScreen(topN: number, rsiMin: number, mcapMin: number, volMin: number, start: number) {
  try {
    // Load 750-stock universe + market cap + sector from CSV
    const csvSymbols = await getNifty750Symbols();
    if (csvSymbols.length === 0) return null; // CSV not available

    const csvMap = await getNifty750Map();

    // Download OHLCV via Yahoo v8 chart (only thing we still need Yahoo for)
    const dataMap = await batchFetchDailyCandles(csvSymbols, "1y", 3);
    if (dataMap.size === 0) return null; // Yahoo rate-limited

    // Compute indicators for each stock
    const metricsList = [];
    for (const sym of csvSymbols) {
      const data = dataMap.get(sym);
      if (!data) continue;
      const m = computeMetrics(sym, data.candles);
      if (m) metricsList.push(m);
    }

    // Apply technical + volume filter
    const techPassed = metricsList.filter((m) =>
      applyTechnicalFilter(m) && m.rsi14 > rsiMin && m.avgVolume30d > volMin
    );
    if (techPassed.length === 0) return null;

    // Apply market cap filter using CSV data (NO Yahoo .info calls!)
    const screened: ScreenedStock[] = [];
    for (const m of techPassed) {
      const csvData = csvMap.get(m.symbol);
      if (!csvData) continue;
      if (csvData.marketCapCr <= mcapMin) continue;
      screened.push({
        ...m,
        longName: csvData.longName,
        sector: csvData.sector,
        industry: csvData.industry,
        marketCapCr: csvData.marketCapCr,
        rank: 0,
      });
    }

    // Sort by 6M return DESC, take top N
    screened.sort((a, b) => b.ret6mPct - a.ret6mPct);
    const top10 = screened.slice(0, topN).map((s, i) => ({ ...s, rank: i + 1 }));

    return {
      universeSize: csvSymbols.length,
      passedData: metricsList.length,
      passedTech: techPassed.length,
      passedMc: screened.length,
      top10,
      runAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
      cached: false,
      topN,
      filters: { rsiMin, mcapMin, volMin },
      backend: "csv-typescript",
    };
  } catch {
    return null;
  }
}

async function tryTypeScript(topN: number, rsiMin: number, mcapMin: number, volMin: number, start: number) {
  try {
    const universe = dedupUniverse;
    const dataMap = await batchFetchDailyCandles(universe, "1y", 3);
    if (dataMap.size === 0) return null;

    const metricsList = [];
    for (const sym of universe) {
      const data = dataMap.get(sym);
      if (!data) continue;
      const m = computeMetrics(sym, data.candles);
      if (m) metricsList.push(m);
    }

    const techPassed = metricsList.filter((m) =>
      applyTechnicalFilter(m) && m.rsi14 > rsiMin && m.avgVolume30d > volMin
    );
    if (techPassed.length === 0) return null;

    const techSymbols = techPassed.map((m) => m.symbol);
    const quoteMap = await fetchBatchQuotes(techSymbols);

    const screened: ScreenedStock[] = [];
    for (const m of techPassed) {
      const q = quoteMap.get(m.symbol);
      if (!q?.marketCap) continue;
      const marketCapCr = q.marketCap / 1e7;
      if (marketCapCr <= mcapMin) continue;
      screened.push({
        ...m,
        longName: (q.longName && q.longName !== "N/A") ? q.longName : (q.shortName || m.symbol),
        sector: "—",
        industry: "—",
        marketCapCr,
        rank: 0,
      });
    }

    screened.sort((a, b) => b.ret6mPct - a.ret6mPct);
    const top10 = screened.slice(0, topN).map((s, i) => ({ ...s, rank: i + 1 }));

    return {
      universeSize: universe.length,
      passedData: metricsList.length,
      passedTech: techPassed.length,
      passedMc: screened.length,
      top10,
      runAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
      cached: false,
      topN,
      filters: { rsiMin, mcapMin, volMin },
      backend: "typescript",
    };
  } catch {
    return null;
  }
}
