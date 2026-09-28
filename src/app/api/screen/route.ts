// GET /api/screen
// Hybrid: tries Vercel Python serverless function first (when deployed on Vercel),
// falls back to local Python execFile (in sandbox),
// falls back to pure TypeScript (when Python not available),
// falls back to cache.

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { dedupUniverse } from "@/lib/universe";
import { batchFetchDailyCandles } from "@/lib/yahoo";
import { fetchBatchQuotes } from "@/lib/yahoo-batch";
import { computeMetrics, ScreenedStock } from "@/lib/indicators";
import { applyTechnicalFilter } from "@/lib/strategy";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  // 2. Try Vercel Python serverless function (works when deployed on Vercel)
  if (PYTHON_API_URL) {
    const pyResult = await tryVercelPython(topN, rsiMin, mcapMin, volMin, start);
    if (pyResult) {
      cache.set(cacheKey, { data: pyResult, ts: Date.now() });
      lastSuccessful = { data: pyResult, ts: Date.now() };
      return NextResponse.json(pyResult);
    }
  }

  // 3. Try local Python (works in sandbox)
  const localPyResult = await tryLocalPython(topN, rsiMin, mcapMin, volMin, start);
  if (localPyResult) {
    cache.set(cacheKey, { data: localPyResult, ts: Date.now() });
    lastSuccessful = { data: localPyResult, ts: Date.now() };
    return NextResponse.json(localPyResult);
  }

  // 4. Try pure TypeScript (works when Yahoo isn't rate-limiting)
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
    const filtersJson = JSON.stringify({ rsi_min: rsiMin, mcap_min_cr: mcapMin, vol_min: volMin });
    const { stdout } = await execFileAsync(
      PYTHON,
      [SCRIPT, "screen", String(topN), filtersJson],
      { timeout: 90_000, maxBuffer: 50 * 1024 * 1024 }
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
