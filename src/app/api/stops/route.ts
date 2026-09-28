// POST /api/stops
// Pure TypeScript — no Python dependency.
// Fetches fresh OHLCV for held symbols, computes stop-loss levels.

import { NextResponse } from "next/server";
import { batchFetchDailyCandles } from "@/lib/yahoo";
import { computeMetrics, AllocationStock } from "@/lib/indicators";
import { computeStopLoss } from "@/lib/strategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const alloc = body.allocation as AllocationStock[];
    if (!Array.isArray(alloc) || alloc.length === 0) {
      return NextResponse.json({ error: "allocation[] is required" }, { status: 400 });
    }

    // Fetch fresh OHLCV for held symbols (concurrency=3)
    const symbols = alloc.map((a) => a.symbol);
    const dataMap = await batchFetchDailyCandles(symbols, "6mo", 3);

    // Build fresh metrics map
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
