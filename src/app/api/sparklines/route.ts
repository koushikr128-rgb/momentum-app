// GET /api/sparklines?symbols=RELIANCE,TCS,INFY
// Returns 30-day closing prices for each symbol — used for mini sparkline charts

import { NextResponse } from "next/server";
import { batchFetchDailyCandles } from "@/lib/yahoo";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RENDER_URL = process.env.RENDER_URL || "";
const IS_SANDBOX = !RENDER_URL && process.env.VERCEL !== "1";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols") || "";
  const symbols = symbolsParam.split(",").filter(Boolean).map(s => s.trim().toUpperCase()).slice(0, 50);

  if (symbols.length === 0) {
    return NextResponse.json({ error: "No symbols provided" }, { status: 400 });
  }

  // Try Yahoo direct (fastest for small sets)
  try {
    const yahooSymbols = symbols.map(s => s.endsWith(".NS") ? s : `${s}.NS`);
    const dataMap = await batchFetchDailyCandles(yahooSymbols, "1mo", 1);

    if (dataMap.size > 0) {
      const result: Record<string, number[]> = {};
      for (const sym of symbols) {
        const key = sym.endsWith(".NS") ? sym : `${sym}.NS`;
        const data = dataMap.get(key);
        if (data && data.candles.length > 5) {
          // Take last 30 closes
          const closes = data.candles.slice(-30).map(c => c.close);
          result[sym] = closes;
        }
      }
      if (Object.keys(result).length > 0) {
        return NextResponse.json({ sparklines: result, source: "yahoo" });
      }
    }
  } catch {}

  // Fallback: if we have a Render backend, try fetching from there
  // (Render doesn't have a sparklines endpoint, but the analyze endpoint has price data)
  // For now, return empty — sparklines will show "—"
  return NextResponse.json({ sparklines: {}, source: "none" });
}
