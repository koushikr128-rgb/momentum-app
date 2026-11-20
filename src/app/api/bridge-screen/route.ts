// GET /api/bridge-screen?topN=10&rsiMin=50&mcapMin=200&volMin=20000
// Pullback Bridge Screener — stale-while-revalidate: serves cached data
// instantly and refreshes in the background, so requests never exceed
// Next.js maxDuration=60 (which killed the old synchronous 110s scan).

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RENDER_URL = process.env.RENDER_URL || "";
const IS_SANDBOX = !RENDER_URL && process.env.VERCEL !== "1";

type CacheEntry = { data: unknown; ts: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const STALE_REFRESH_MS = 2 * 60 * 1000;
let refreshing: Promise<void> | null = null;
let refreshingKey: string | null = null;
let lastSuccessful: CacheEntry | null = null;

async function runBridgeScan(topN: number, rsiMin: number, mcapMin: number, volMin: number): Promise<any> {
  const filters = { rsi_min: rsiMin, mcap_min_cr: mcapMin, vol_min: volMin };

  // 1. Try Render backend (Vercel deployment)
  if (RENDER_URL) {
    try {
      const res = await fetch(`${RENDER_URL}/bridge-screen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topN, filters }),
        cache: "no-store",
        signal: AbortSignal.timeout(110000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && (!data.error || (data.top10 && data.top10.length > 0))) return data;
      }
    } catch {}
  }

  // 2. Local Python (sandbox)
  if (IS_SANDBOX) {
    try {
      const scriptPath = path.join(process.cwd(), "scripts", "yfinance_backend.py");
      const { stdout } = await execAsync(
        `python3 ${scriptPath} bridge_screen ${topN} '${JSON.stringify(filters)}'`,
        { timeout: 180000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, PYTHONPATH: "/home/z/my-project/pylibs" } }
      );
      const data = JSON.parse(stdout);
      if (data && (!data.error || (data.top10 && data.top10.length > 0))) return data;
    } catch (e: any) {
      console.error("[bridge-screen] scan error:", e.message);
    }
  }
  return null;
}

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

  // Kick off a non-blocking background refresh if one isn't already running.
  const triggerBackgroundRefresh = () => {
    if (refreshing && refreshingKey === cacheKey) return;
    refreshingKey = cacheKey;
    refreshing = (async () => {
      try {
        const result = await runBridgeScan(topN, rsiMin, mcapMin, volMin);
        if (result) {
          cache.set(cacheKey, { data: result, ts: Date.now() });
          lastSuccessful = { data: result, ts: Date.now() };
          console.log(`[bridge-screen] background refresh done in ${Date.now() - start}ms`);
        }
      } catch (e) {
        console.log(`[bridge-screen] background refresh error:`, (e as Error).message);
      } finally {
        refreshing = null;
        refreshingKey = null;
      }
    })();
  };

  // 1. Fresh cache → return instantly
  if (cached && cacheAge < CACHE_TTL_MS) {
    if (cacheAge > STALE_REFRESH_MS) triggerBackgroundRefresh();
    return NextResponse.json({
      ...(cached.data as object),
      cached: true, cacheAge,
      refreshing: refreshingKey === cacheKey,
      elapsedMs: Date.now() - start,
    });
  }

  // 2. Stale cache → return instantly + background refresh
  if (cached) {
    triggerBackgroundRefresh();
    return NextResponse.json({
      ...(cached.data as object),
      cached: true, stale: true, cacheAge, refreshing: true,
      elapsedMs: Date.now() - start,
      warning: "Refreshing in background — latest data will appear shortly.",
    });
  }

  // 3. No cache — trigger background refresh, return lastSuccessful or graceful error.
  //    NEVER run a synchronous scan here (would exceed maxDuration=60 and fail).
  triggerBackgroundRefresh();

  if (lastSuccessful) {
    const lsData = lastSuccessful.data as Record<string, unknown>;
    const sliced = (lsData.top10 as unknown[]).slice(0, topN);
    return NextResponse.json({
      ...lsData, top10: sliced, topN,
      cached: true, stale: true, fallback: true, refreshing: true,
      cacheAge: Date.now() - lastSuccessful.ts,
      elapsedMs: Date.now() - start,
      warning: "Refreshing in background — latest data will appear shortly.",
    });
  }

  // 4. Cold start — graceful, instant response (NOT a 500). Frontend retries.
  return NextResponse.json({
    error: "Warming up — fetching bridge data in the background. Please retry in ~90s.",
    warning: "First load after server restart. The next Bridge Screen will return live data.",
    universeSize: 0, passedData: 0, passedTech: 0, passedMc: 0, top10: [],
    runAt: new Date().toISOString(), screenType: "bridge",
    cached: false, refreshing: true,
    elapsedMs: Date.now() - start,
  });
}
