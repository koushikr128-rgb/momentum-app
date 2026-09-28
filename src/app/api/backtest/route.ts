// GET /api/backtest
// Spawns Python backtest backend — downloads 3y OHLCV, runs 2y monthly rebalance
import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PYTHON = "/home/z/.venv/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/backtest_backend.py";

// 1-hour cache — backtest takes ~30-60s and rarely changes intra-day
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function GET() {
  const start = Date.now();
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ ...(cache.data as object), cached: true, cacheAge: Date.now() - cache.ts, elapsedMs: Date.now() - start });
  }
  try {
    await fs.access(SCRIPT);
    const { stdout, stderr } = await execFileAsync(PYTHON, [SCRIPT], {
      timeout: 280_000,
      maxBuffer: 50 * 1024 * 1024,
    });
    void stderr;
    const data = JSON.parse(stdout.trim().split("\n").pop() as string);
    const enriched = { ...data, elapsedMs: Date.now() - start, cached: false };
    cache = { data: enriched, ts: Date.now() };
    return NextResponse.json(enriched);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Backtest backend failed",
        equity_curve: [],
        monthly_returns: [],
        summary: null,
        picks_history: [],
        run_at: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
