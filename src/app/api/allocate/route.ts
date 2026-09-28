// POST /api/allocate
// Body: { stocks: ScreenedStock[], totalInvestment: number }
// Returns: { allocation, removedStocks, totalInvested, totalAllocated, cashLeftover, sectorBreakdown }

import { NextResponse } from "next/server";
import { computeAllocation } from "@/lib/strategy";
import { ScreenedStock, AllocationStock } from "@/lib/indicators";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const stocks = body.stocks as ScreenedStock[];
    const totalInvestment = Number(body.totalInvestment || 200000);

    if (!Array.isArray(stocks) || stocks.length === 0) {
      return NextResponse.json({ error: "stocks[] is required" }, { status: 400 });
    }

    const { allocation, removedStocks } = computeAllocation(stocks, totalInvestment);
    return NextResponse.json({
      allocation,
      removedStocks,
      totalInvested: totalInvestment,
      totalAllocated: allocation.reduce((a, b) => a + b.rupees, 0),
      cashLeftover: totalInvestment - allocation.reduce((a, b) => a + b.shares * b.currentPrice, 0),
      sectorBreakdown: computeSectorBreakdown(allocation),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}

function computeSectorBreakdown(alloc: AllocationStock[]) {
  const m = new Map<string, { weight: number; count: number; rupees: number }>();
  for (const s of alloc) {
    const cur = m.get(s.sector) || { weight: 0, count: 0, rupees: 0 };
    cur.weight += s.weight;
    cur.count += 1;
    cur.rupees += s.rupees;
    m.set(s.sector, cur);
  }
  return Array.from(m.entries())
    .map(([sector, v]) => ({ sector, ...v }))
    .sort((a, b) => b.weight - a.weight);
}
