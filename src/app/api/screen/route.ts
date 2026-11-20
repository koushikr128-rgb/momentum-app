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

const PYTHON = "/usr/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/yfinance_backend.py";
// yfinance + deps installed to a project-local dir that survives sandbox recycles
const PY_ENV = { ...process.env, PYTHONPATH: "/home/z/my-project/pylibs" };

// Render Python backend URL (set as env var on Vercel)
const RENDER_URL = process.env.RENDER_URL || "";
const IS_SANDBOX = !RENDER_URL && process.env.VERCEL !== "1";

type CacheEntry = { data: unknown; ts: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;
// When cache is older than this, serve it instantly (stale) AND kick off a
// background refresh — so the user never waits 90s or sees "Screen Failed".
const STALE_REFRESH_MS = 2 * 60 * 1000;
let lastSuccessful: CacheEntry | null = null;
// A single in-flight background refresh promise (prevents overlapping 90s scans)
let refreshing: Promise<void> | null = null;
let refreshingKey: string | null = null;

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

  // Kick off a non-blocking background refresh (90s scan) if one isn't already
  // running for this key. Updates the cache when it completes; the caller never waits.
  const triggerBackgroundRefresh = () => {
    if (refreshing && refreshingKey === cacheKey) return; // already refreshing this key
    refreshingKey = cacheKey;
    refreshing = (async () => {
      const rStart = Date.now();
      try {
        let result: any = null;
        if (IS_SANDBOX) result = await tryLocalPython(topN, rsiMin, mcapMin, volMin, rStart);
        if (!result) result = await tryPublishedScreen(topN, rStart);
        if (!result && RENDER_URL) result = await tryRenderBackend(topN, rsiMin, mcapMin, volMin, rStart);
        if (!result) result = await tryCsvScreen(topN, rsiMin, mcapMin, volMin, rStart);
        if (!result) result = await tryTypeScript(topN, rsiMin, mcapMin, volMin, rStart);
        if (result) {
          cache.set(cacheKey, { data: result, ts: Date.now() });
          lastSuccessful = { data: result, ts: Date.now() };
          console.log(`[screen] background refresh done in ${Date.now() - rStart}ms`);
        } else {
          console.log(`[screen] background refresh found no data after ${Date.now() - rStart}ms`);
        }
      } catch (e) {
        console.log(`[screen] background refresh error:`, (e as Error).message);
      } finally {
        refreshing = null;
        refreshingKey = null;
      }
    })();
  };

  // 1. Fresh cache hit → return instantly
  if (cached && cacheAge < CACHE_TTL_MS) {
    // If approaching staleness, proactively refresh in the background
    if (cacheAge > STALE_REFRESH_MS) triggerBackgroundRefresh();
    return NextResponse.json({
      ...(cached.data as object),
      cached: true, cacheAge,
      refreshing: refreshingKey === cacheKey,
      elapsedMs: Date.now() - start,
      topN, filters: { rsiMin, mcapMin, volMin },
    });
  }

  // 2. Stale cache → return it instantly (never fail) + trigger background refresh
  if (cached) {
    triggerBackgroundRefresh();
    return NextResponse.json({
      ...(cached.data as object),
      cached: true, stale: true, cacheAge,
      refreshing: true,
      elapsedMs: Date.now() - start,
      topN, filters: { rsiMin, mcapMin, volMin },
      warning: "Refreshing in background — latest data will appear shortly.",
    });
  }

  // 3. No cache at all — try the FAST published fallback first (local file),
  //    return it instantly + background-refresh with live data.
  const published = await tryPublishedScreen(topN, start);
  if (published) {
    cache.set(cacheKey, { data: published, ts: Date.now() });
    lastSuccessful = { data: published, ts: Date.now() };
    triggerBackgroundRefresh();
    return NextResponse.json({
      ...published, refreshing: true,
      elapsedMs: Date.now() - start,
      topN, filters: { rsiMin, mcapMin, volMin },
      warning: "Refreshing in background — latest data will appear shortly.",
    });
  }

  // 4. No cache AND no published data — NEVER do a synchronous 90s scan here
  //    (it would exceed Next.js maxDuration=60 and fail). Instead: kick off a
  //    background refresh and return lastSuccessful instantly, or a graceful
  //    error if we truly have nothing. The frontend polls and picks up fresh
  //    data once the background scan completes.
  triggerBackgroundRefresh();

  if (lastSuccessful) {
    const lsData = lastSuccessful.data as Record<string, unknown>;
    const sliced = (lsData.top10 as unknown[]).slice(0, topN);
    return NextResponse.json({
      ...lsData, top10: sliced, topN,
      cached: true, stale: true, fallback: true, refreshing: true,
      cacheAge: Date.now() - lastSuccessful.ts,
      elapsedMs: Date.now() - start,
      filters: { rsiMin, mcapMin, volMin },
      warning: "Refreshing in background — latest data will appear shortly.",
    });
  }

  // 5. No data at all yet (cold start) — return a graceful, instant response.
  //    The background refresh is already running; the frontend will retry.
  return NextResponse.json({
    error: "Warming up — fetching fresh data in the background. Please retry in ~90s.",
    warning: "First load after server restart. The next Run Screen will return live data.",
    universeSize: 0, passedData: 0, passedTech: 0, passedMc: 0, top10: [],
    runAt: new Date().toISOString(),
    elapsedMs: Date.now() - start, cached: false, refreshing: true,
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
    // Check if yfinance is installed
    const { stdout: checkOut } = await execFileAsync(
      PYTHON, ["-c", "import yfinance; print('OK')"],
      { timeout: 10_000, env: PY_ENV }
    ).catch(() => ({ stdout: "", stderr: "import failed" }));

    if (!checkOut.includes("OK")) {
      // yfinance not installed — install to the persistent project dir, return null (will fall through to published data)
      console.log("[screen] yfinance missing — installing in background...");
      execFileAsync(
        PYTHON, ["-m", "pip", "install", "yfinance", "curl_cffi", "pandas", "numpy", "--quiet", "--target", "/home/z/my-project/pylibs"],
        { timeout: 120_000, env: PY_ENV }
      ).then(() => console.log("[screen] yfinance installed in background")).catch(() => {});
      return null; // Fall through to published data or CSV fallback
    }

    const filtersJson = JSON.stringify({ rsi_min: rsiMin, mcap_min_cr: mcapMin, vol_min: volMin });
    const { stdout } = await execFileAsync(
      PYTHON,
      [SCRIPT, "screen", String(topN), filtersJson],
      { timeout: 240_000, maxBuffer: 50 * 1024 * 1024, env: PY_ENV }
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
