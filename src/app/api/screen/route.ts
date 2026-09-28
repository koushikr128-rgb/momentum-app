// GET /api/screen
// Spawns Python yfinance backend to fetch + compute indicators
import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — Python script takes ~45-60s

const PYTHON = "/home/z/.venv/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/yfinance_backend.py";

// Cache the result in memory for 10 minutes so repeated dashboard refreshes are instant
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET() {
  const start = Date.now();
  // Return cached result if fresh
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ ...(cache.data as object), cached: true, cacheAge: Date.now() - cache.ts, elapsedMs: Date.now() - start });
  }
  try {
    // Verify Python script exists
    await fs.access(SCRIPT);
    const { stdout, stderr } = await execFileAsync(PYTHON, [SCRIPT, "screen"], {
      timeout: 240_000,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (stderr && !stderr.includes("ERROR") && !stderr.includes("Failed download")) {
      // yfinance prints download errors as stderr, but JSON still goes to stdout
    }
    const data = JSON.parse(stdout.trim().split("\n").pop() as string);
    const enriched = { ...data, elapsedMs: Date.now() - start, cached: false };
    cache = { data: enriched, ts: Date.now() };
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
      },
      { status: 500 }
    );
  }
}

// Helper for path resolution (kept for future flexibility)
function resolveScript() {
  return path.isAbsolute(SCRIPT) ? SCRIPT : path.resolve(process.cwd(), SCRIPT);
}
