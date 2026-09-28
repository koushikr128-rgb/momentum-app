// GET /api/screen
// Spawns Python yfinance backend to fetch + compute indicators
// Query params:
//   topN     — number of stocks to return (default 10, max 50)
//   rsiMin   — minimum RSI(14) threshold (default 50, was 55)
//   mcapMin  — minimum market cap in ₹ Cr (default 200, was 500)
//   volMin   — minimum 30-day avg volume (default 20000, was 50000)
import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PYTHON = "/home/z/.venv/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/yfinance_backend.py";

// Cache keyed by composite key (topN + filter thresholds) — each variant cached for 10 min
type CacheEntry = { data: unknown; ts: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET(req: Request) {
  const start = Date.now();
  const url = new URL(req.url);
  const topN = Math.max(1, Math.min(50, Number(url.searchParams.get("topN") || "10")));
  const rsiMin = Number(url.searchParams.get("rsiMin") || "50");
  const mcapMin = Number(url.searchParams.get("mcapMin") || "200");
  const volMin = Number(url.searchParams.get("volMin") || "20000");

  const cacheKey = `${topN}-${rsiMin}-${mcapMin}-${volMin}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({
      ...(cached.data as object),
      cached: true,
      cacheAge: Date.now() - cached.ts,
      elapsedMs: Date.now() - start,
      topN,
      filters: { rsiMin, mcapMin, volMin },
    });
  }
  try {
    await fs.access(SCRIPT);
    const filtersJson = JSON.stringify({ rsi_min: rsiMin, mcap_min_cr: mcapMin, vol_min: volMin });
    const { stdout, stderr } = await execFileAsync(
      PYTHON,
      [SCRIPT, "screen", String(topN), filtersJson],
      { timeout: 240_000, maxBuffer: 50 * 1024 * 1024 }
    );
    void stderr;
    const data = JSON.parse(stdout.trim().split("\n").pop() as string);
    const enriched = {
      ...data,
      elapsedMs: Date.now() - start,
      cached: false,
      topN,
      filters: { rsiMin, mcapMin, volMin },
    };
    cache.set(cacheKey, { data: enriched, ts: Date.now() });
    return NextResponse.json(enriched);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Backend Python script failed",
        universeSize: 0,
        passedData: 0,
        passedTech: 0,
        passedMc: 0,
        top10: [],
        runAt: new Date().toISOString(),
        topN,
        filters: { rsiMin, mcapMin, volMin },
      },
      { status: 500 }
    );
  }
}
