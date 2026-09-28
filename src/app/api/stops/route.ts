// POST /api/stops
// Spawns Python yfinance backend to fetch fresh OHLCV and compute stop-loss status
import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { AllocationStock } from "@/lib/indicators";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PYTHON = "/home/z/.venv/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/yfinance_backend.py";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const alloc = body.allocation as AllocationStock[];
    if (!Array.isArray(alloc) || alloc.length === 0) {
      return NextResponse.json({ error: "allocation[] is required" }, { status: 400 });
    }

    const payload = alloc.map((a) => ({
      symbol: a.symbol,
      sector: a.sector,
      entryPrice: a.currentPrice,
      shares: a.shares,
      rupees: a.rupees,
    }));

    const { stdout } = await execFileAsync(
      PYTHON,
      [SCRIPT, "stops", JSON.stringify(payload)],
      { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 }
    );

    const data = JSON.parse(stdout.trim().split("\n").pop() as string);
    const stops = data.stops as Array<{ pnlRupees: number; rupees: number; status: string }>;
    const totalPnl = stops.reduce((a, b) => a + b.pnlRupees, 0);
    const totalInvested = stops.reduce((a, b) => a + b.rupees, 0);

    return NextResponse.json({
      ...data,
      totalPnl,
      totalInvested,
      pnlPct: (totalPnl / totalInvested) * 100,
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
