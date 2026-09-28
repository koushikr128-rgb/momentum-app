// GET /api/screen
// Hybrid approach: tries pure TypeScript first (deploys anywhere),
// falls back to Python yfinance if available (more reliable, uses curl_cffi).
// This way it works both in sandbox (Python) and when deployed (TS).

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { dedupUniverse } from "@/lib/universe";
import { batchFetchDailyCandles } from "@/lib/yahoo";
import { fetchBatchQuotes } from "@/lib/yahoo-batch";
import { computeMetrics, ScreenedStock } from "@/lib/indicators";
import { applyMarketCapFilter, applyTechnicalFilter } from "@/lib/strategy";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PYTHON = "/home/z/.venv/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/yfinance_backend.py";

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

  if (cached && cacheAge < CACHE_TTL_MS) {
    return NextResponse.json({
      ...(cached.data as object),
      cached: true, cacheAge,
      elapsedMs: Date.now() - start,
      topN, filters: { rsiMin, mcapMin, volMin },
    });
  }

  // Try pure TypeScript first
  let result = await tryTsScreen(topN, rsiMin, mcapMin, volMin, start);

  // If TS failed (rate-limited), try Python backend
  if (!result || (result as Record<string, unknown>).top10?.length === 0) {
    result = await tryPythonScreen(topN, rsiMin, mcapMin, volMin, start);
  }

  // If both failed, fall back to cache
  if (!result || ((result as Record<string, unknown>).top10 as unknown[])?.length === 0) {
    if (cached) {
      return NextResponse.json({
        ...(cached.data as object),
        cached: true, stale: true, cacheAge,
        elapsedMs: Date.now() - start,
        topN, filters: { rsiMin, mcapMin, volMin },
        warning: "Yahoo Finance rate-limited. Showing cached data.",
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
        warning: "Yahoo Finance rate-limited. Showing fallback data.",
      });
    }
    return NextResponse.json({
      error: "Yahoo Finance rate-limited. Please try again later.",
      universeSize: 0, passedData: 0, passedTech: 0, passedMc: 0, top10: [],
      runAt: new Date().toISOString(),
      elapsedMs: Date.now() - start, cached: false,
      topN, filters: { rsiMin, mcapMin, volMin },
    });
  }

  // Success — cache it
  cache.set(cacheKey, { data: result, ts: Date.now() });
  lastSuccessful = { data: result, ts: Date.now() };
  return NextResponse.json(result);
}

async function tryTsScreen(topN: number, rsiMin: number, mcapMin: number, volMin: number, start: number) {
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

async function tryPythonScreen(topN: number, rsiMin: number, mcapMin: number, volMin: number, start: number) {
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
      backend: "python",
    };
  } catch {
    return null;
  }
}
