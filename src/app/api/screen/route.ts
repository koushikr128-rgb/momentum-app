// GET /api/screen
// Hybrid: tries Render Python backend (when RENDER_URL is set),
// falls back to local Python execFile (in sandbox),
// falls back to CSV-backed TypeScript,
// falls back to cache.

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { dedupUniverse } from "@/lib/universe";
import { batchFetchDailyCandles } from "@/lib/yahoo";
import { fetchBatchQuotes } from "@/lib/yahoo-batch";
import { computeMetrics, ScreenedStock, StockMetrics } from "@/lib/indicators";
import { applyTechnicalFilter } from "@/lib/strategy";
import { getNifty750Symbols, getNifty750Map } from "@/lib/nifty750";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PYTHON = "/home/z/.venv/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/yfinance_backend.py";

// Render Python backend URL (set as env var on Vercel)
const RENDER_URL = process.env.RENDER_URL || "";
const IS_SANDBOX = !RENDER_URL && process.env.VERCEL !== "1";

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

  // 1.5. Try published screen data (from GitHub — published by sandbox)
  if (RENDER_URL || !IS_SANDBOX) {
    const publishedResult = await tryPublishedScreen(topN, start);
    if (publishedResult) {
      cache.set(cacheKey, { data: publishedResult, ts: Date.now() });
      lastSuccessful = { data: publishedResult, ts: Date.now() };
      return NextResponse.json(publishedResult);
    }
  }

  // 2. Try Render Python backend (when deployed on Vercel with RENDER_URL)
  if (RENDER_URL) {
    const renderResult = await tryRenderBackend(topN, rsiMin, mcapMin, volMin, start);
    if (renderResult) {
      cache.set(cacheKey, { data: renderResult, ts: Date.now() });
      lastSuccessful = { data: renderResult, ts: Date.now() };
      return NextResponse.json(renderResult);
    }
  }

  // 3. Try local Python (sandbox only — uses CSV for market cap + yfinance for OHLCV)
  if (IS_SANDBOX) {
    const localPyResult = await tryLocalPython(topN, rsiMin, mcapMin, volMin, start);
    if (localPyResult) {
      cache.set(cacheKey, { data: localPyResult, ts: Date.now() });
      lastSuccessful = { data: localPyResult, ts: Date.now() };
      return NextResponse.json(localPyResult);
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

// Try reading published screen data from GitHub (published by sandbox)
async function tryPublishedScreen(topN: number, start: number) {
  try {
    // Read from local file first (if it exists — baked into Vercel deployment)
    const fs = await import("fs/promises");
    const path = await import("path");
    const filePath = path.join(process.cwd(), "data", "latest_screen.json");
    const fileContent = await fs.readFile(filePath, "utf-8").catch(() => null);

    if (!fileContent) {
      // Fallback: fetch from GitHub raw URL
      const githubRes = await fetch(
        "https://raw.githubusercontent.com/koushikr128-rgb/momentum-app/main/data/latest_screen.json",
        { cache: "no-store", signal: AbortSignal.timeout(5000) }
      );
      if (!githubRes.ok) return null;
      const data = await githubRes.json();
      if (!data || !data.top10 || data.top10.length === 0) return null;
      return {
        ...data,
        elapsedMs: Date.now() - start,
        cached: true,
        backend: "published",
        topN,
        filters: { rsiMin: 0, mcapMin: 0, volMin: 0 },
      };
    }

    const data = JSON.parse(fileContent);
    if (!data || !data.top10 || data.top10.length === 0) return null;

    // Slice to requested topN
    const sliced = {
      ...data,
      top10: data.top10.slice(0, topN).map((s: any, i: number) => ({ ...s, rank: i + 1 })),
      elapsedMs: Date.now() - start,
      cached: true,
      backend: "published",
      topN,
      publishedAt: data.publishedAt,
    };
    return sliced;
  } catch {
    return null;
  }
}

async function tryRenderBackend(topN: number, rsiMin: number, mcapMin: number, volMin: number, start: number) {
  try {
    const res = await fetch(`${RENDER_URL}/screen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN, filters: { rsi_min: rsiMin, mcap_min_cr: mcapMin, vol_min: volMin } }),
      cache: "no-store",
      signal: AbortSignal.timeout(55000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !data.top10 || data.top10.length === 0) return null;
    return {
      ...data,
      elapsedMs: Date.now() - start,
      cached: false,
      topN,
      filters: { rsiMin, mcapMin, volMin },
      backend: "render",
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
    const metricsList: StockMetrics[] = [];
    for (const sym of csvSymbols) {
      const data = dataMap.get(sym);
      if (!data) continue;
      const m = computeMetrics(sym, data.candles);
      if (m) metricsList.push(m);
    }

    // Apply technical + volume filter
    const techPassed = metricsList.filter((m: StockMetrics) =>
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

    // Sort by composite Signal Score DESC (Phase 1)
    screened.sort((a, b) => (b.signalScore ?? 0) - (a.signalScore ?? 0));
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

    const metricsList: StockMetrics[] = [];
    for (const sym of universe) {
      const data = dataMap.get(sym);
      if (!data) continue;
      const m = computeMetrics(sym, data.candles);
      if (m) metricsList.push(m);
    }

    const techPassed = metricsList.filter((m: StockMetrics) =>
      applyTechnicalFilter(m) && m.rsi14 > rsiMin && m.avgVolume30d > volMin
    );
    if (techPassed.length === 0) return null;

    const techSymbols = techPassed.map((m: StockMetrics) => m.symbol);
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

    screened.sort((a, b) => (b.signalScore ?? 0) - (a.signalScore ?? 0));
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
