// POST /api/rebalance
// Body: { allocation: AllocationStock[], screen: ScreenedStock[], totalInvestment: number }
// Returns: { items, summary } — per-stock actions (BUY MORE / HOLD / TRIM / EXIT / INITIATE)

import { NextResponse } from "next/server";
import { computeRebalance } from "@/lib/strategy";
import { AllocationStock, ScreenedStock } from "@/lib/indicators";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const allocation = body.allocation as AllocationStock[];
    const screen = body.screen as ScreenedStock[];
    const totalInvestment = Number(body.totalInvestment || 200000);

    if (!Array.isArray(allocation) || !Array.isArray(screen)) {
      return NextResponse.json(
        { error: "allocation[] and screen[] are required" },
        { status: 400 }
      );
    }

    const result = computeRebalance(allocation, screen, totalInvestment);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
