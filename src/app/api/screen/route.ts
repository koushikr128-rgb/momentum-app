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

// Cache keyed by topN — each variant cached independently for 10 minutes
type CacheEntry = { data: unknown; ts: number };
const cache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET(req: Request) {
  const start = Date.now();
  const url = new URL(req.url);
  const topN = Math.max(1, Math.min(50, Number(url.searchParams.get("topN") || "10")));

  const cached = cache.get(topN);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({
      ...(cached.data as object),
      cached: true,
      cacheAge: Date.now() - cached.ts,
      elapsedMs: Date.now() - start,
      topN,
    });
  }
  try {
    await fs.access(SCRIPT);
    const { stdout, stderr } = await execFileAsync(
      PYTHON,
      [SCRIPT, "screen", String(topN)],
      { timeout: 240_000, maxBuffer: 50 * 1024 * 1024 }
    );
    void stderr;
    const data = JSON.parse(stdout.trim().split("\n").pop() as string);
    const enriched = { ...data, elapsedMs: Date.now() - start, cached: false, topN };
    cache.set(topN, { data: enriched, ts: Date.now() });
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
      },
      { status: 500 }
    );
  }
}
