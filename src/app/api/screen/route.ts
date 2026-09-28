// GET /api/screen
// Spawns Python yfinance backend to fetch + compute indicators
// Query params:
//   topN     — number of stocks to return (default 10, max 50)
//   rsiMin   — minimum RSI(14) threshold (default 50, was 55)
//   mcapMin  — minimum market cap in ₹ Cr (default 200, was 500)
//   volMin   — minimum 30-day avg volume (default 20000, was 50000)
//
// Resilience strategy:
//   1. Fresh cache (within 30 min) → return immediately
//   2. Stale cache (older than 30 min) → try fresh fetch, fall back to stale if it fails
//   3. Global "last successful" cache → any variant can fall back to this
//   4. Never return 500 — always return 200 with whatever data we have + error field
import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PYTHON = "/home/z/.venv/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/yfinance_backend.py";

type CacheEntry = { data: unknown; ts: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;

// Global fallback — most recent successful fetch (any variant)
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

  // 1. Fresh cache hit — return immediately
  if (cached && cacheAge < CACHE_TTL_MS) {
    return NextResponse.json({
      ...(cached.data as object),
      cached: true,
      cacheAge,
      elapsedMs: Date.now() - start,
      topN,
      filters: { rsiMin, mcapMin, volMin },
    });
  }

  // 2. Try fresh fetch (with reduced timeout to avoid user frustration)
  try {
    // Skip fs.access() — execFile will fail with a clear error if file is missing.
    // The access() check was causing spurious ENOENT errors during dev server restarts.
    const filtersJson = JSON.stringify({ rsi_min: rsiMin, mcap_min_cr: mcapMin, vol_min: volMin });
    const { stdout, stderr } = await execFileAsync(
      PYTHON,
      [SCRIPT, "screen", String(topN), filtersJson],
      { timeout: 90_000, maxBuffer: 50 * 1024 * 1024 }
    );
    void stderr;
    const lastLine = stdout.trim().split("\n").pop() as string;
    if (!lastLine) throw new Error("Python script returned no output");
    const data = JSON.parse(lastLine);

    // If Python returned an error field but no stocks, treat as failure → fall back to cache
    if (data.error && (!data.top10 || data.top10.length === 0)) {
      throw new Error(data.error);
    }

    const enriched = {
      ...data,
      elapsedMs: Date.now() - start,
      cached: false,
      topN,
      filters: { rsiMin, mcapMin, volMin },
    };
    cache.set(cacheKey, { data: enriched, ts: Date.now() });
    lastSuccessful = { data: enriched, ts: Date.now() };
    return NextResponse.json(enriched);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Backend fetch failed";
    const isEnoent = errMsg.includes("ENOENT") || errMsg.includes("no such file");

    // 3. Fresh fetch failed — fall back to stale cache (even if expired)
    if (cached) {
      return NextResponse.json({
        ...(cached.data as object),
        cached: true,
        stale: true,
        cacheAge,
        elapsedMs: Date.now() - start,
        topN,
        filters: { rsiMin, mcapMin, volMin },
        warning: isEnoent
          ? "Backend script temporarily unavailable (dev server restarting). Showing cached data."
          : "Yahoo Finance rate-limited or timed out. Showing cached data from earlier.",
      });
    }
    // 4. No cache for this variant — try global last successful (different topN/filters)
    if (lastSuccessful) {
      const lsData = lastSuccessful.data as Record<string, unknown>;
      const lsTopN = (lsData.topN as number) || 10;
      const lsStocks = (lsData.top10 as unknown[]) || [];
      const sliced = lsStocks.slice(0, topN);
      return NextResponse.json({
        ...lsData,
        top10: sliced,
        topN,
        cached: true,
        stale: true,
        fallback: true,
        cacheAge: Date.now() - lastSuccessful.ts,
        elapsedMs: Date.now() - start,
        filters: { rsiMin, mcapMin, volMin },
        warning: isEnoent
          ? `Backend script temporarily unavailable. Showing data from a previous successful fetch (Top ${lsTopN}, sliced to ${topN}).`
          : `Yahoo Finance rate-limited. Showing data from a previous successful fetch (Top ${lsTopN}, sliced to ${topN}).`,
      });
    }
    // 5. Truly no data — return empty 200 with error field (not 500, so UI doesn't crash)
    return NextResponse.json({
      error: isEnoent
        ? "Backend script is starting up. Please wait a few seconds and try again."
        : errMsg,
      warning: isEnoent
        ? "The Python backend is temporarily unavailable. Please retry in a few seconds."
        : "Yahoo Finance is rate-limiting requests. Please wait a few minutes and try again.",
      universeSize: 0,
      passedData: 0,
      passedTech: 0,
      passedMc: 0,
      top10: [],
      runAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
      cached: false,
      topN,
      filters: { rsiMin, mcapMin, volMin },
    });
  }
}
