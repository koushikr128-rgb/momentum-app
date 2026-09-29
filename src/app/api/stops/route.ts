// POST /api/stops
// Hybrid: tries Python (yfinance) first, falls back to pure TypeScript.
// Auto-installs yfinance if missing.

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { batchFetchDailyCandles } from "@/lib/yahoo";
import { computeMetrics, AllocationStock } from "@/lib/indicators";
import { computeStopLoss } from "@/lib/strategy";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PYTHON = "/home/z/.venv/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/yfinance_backend.py";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const alloc = body.allocation as AllocationStock[];
    if (!Array.isArray(alloc) || alloc.length === 0) {
      return NextResponse.json({ error: "allocation[] is required" }, { status: 400 });
    }

    // Try Python backend first (more reliable — yfinance bypasses Yahoo TLS blocking)
    const pyResult = await tryPythonStops(alloc);
    if (pyResult) return NextResponse.json(pyResult);

    // Fall back to pure TypeScript
    const symbols = alloc.map((a) => a.symbol);
    const dataMap = await batchFetchDailyCandles(symbols, "6mo", 3);

    const fresh = new Map<string, NonNullable<ReturnType<typeof computeMetrics>>>();
    for (const sym of symbols) {
      const data = dataMap.get(sym);
      if (!data) continue;
      const m = computeMetrics(sym, data.candles);
      if (m) fresh.set(sym, m);
    }

    const stops = computeStopLoss(alloc, fresh);
    const totalPnl = stops.reduce((a, b) => a + b.pnlRupees, 0);
    const totalInvested = stops.reduce((a, b) => a + b.rupees, 0);

    return NextResponse.json({
      stops,
      totalPnl,
      totalInvested,
      pnlPct: (totalPnl / totalInvested) * 100,
      runAt: new Date().toISOString(),
      statusCounts: {
        HOLD: stops.filter((s) => s.status === "HOLD").length,
        WATCH: stops.filter((s) => s.status === "WATCH").length,
        EXIT: stops.filter((s) => s.status === "EXIT").length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}

async function tryPythonStops(alloc: AllocationStock[]) {
  try {
    // Auto-install yfinance if missing
    await execFileAsync(PYTHON, ["-c", "import yfinance"], { timeout: 10_000 }).catch(async () => {
      console.log("[stops] yfinance missing, auto-installing...");
      await execFileAsync(
        PYTHON, ["-m", "pip", "install", "yfinance", "pandas", "numpy", "--quiet"],
        { timeout: 120_000 }
      );
    });

    const payload = JSON.stringify(alloc.map((a) => ({
      symbol: a.symbol,
      sector: a.sector,
      entryPrice: a.currentPrice,
      shares: a.shares,
      rupees: a.rupees,
    })));

    const { stdout } = await execFileAsync(
      PYTHON, [SCRIPT, "stops", payload],
      { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }
    );
    const lastLine = stdout.trim().split("\n").pop();
    if (!lastLine) return null;
    return JSON.parse(lastLine);
  } catch {
    return null;
  }
}
