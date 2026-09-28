// POST /api/stress
// Body: { allocation: AllocationStock[], totalInvested: number }
// Returns: StressScenario[] with 5 scenarios

import { NextResponse } from "next/server";
import { computeStressTest } from "@/lib/strategy";
import { AllocationStock } from "@/lib/indicators";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const alloc = body.allocation as AllocationStock[];
    const totalInvested = Number(body.totalInvested || 200000);

    if (!Array.isArray(alloc) || alloc.length === 0) {
      return NextResponse.json({ error: "allocation[] is required" }, { status: 400 });
    }

    const scenarios = computeStressTest(alloc, totalInvested);
    return NextResponse.json({
      scenarios,
      totalInvested,
      worstDrawdown: Math.max(...scenarios.map((s) => s.drawdownPct)),
      worstLoss: Math.min(...scenarios.map((s) => s.totalLoss)),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
