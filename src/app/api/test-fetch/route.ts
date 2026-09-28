import { NextResponse } from "next/server";
import { fetchDailyCandles } from "@/lib/yahoo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    console.log("About to call fetchDailyCandles...");
    const result = await fetchDailyCandles("RELIANCE", "1y");
    console.log("Result:", result ? `${result.candles.length} candles` : "null");
    return NextResponse.json({
      result: result ? { candles: result.candles.length, symbol: result.meta.symbol } : null,
    });
  } catch (e) {
    console.error("Error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message + "\n" + e.stack : "unknown" });
  }
}
