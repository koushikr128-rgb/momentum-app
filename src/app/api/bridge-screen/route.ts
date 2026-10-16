// GET /api/bridge-screen?topN=10&rsiMin=50&mcapMin=200&volMin=20000
// Pullback Bridge Screener — finds stocks with Monthly RSI 55-75, trend intact,
// and at least one entry tactic READY or TRIGGERED. Returns top N with trailing SL.

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // 2Y download for 750 stocks takes ~60-90s

export async function GET(req: Request) {
  const url = new URL(req.url);
  const topN = Math.max(1, Math.min(50, Number(url.searchParams.get("topN") || "10")));
  const rsiMin = Number(url.searchParams.get("rsiMin") || "50");
  const mcapMin = Number(url.searchParams.get("mcapMin") || "200");
  const volMin = Number(url.searchParams.get("volMin") || "20000");

  const filters = JSON.stringify({ rsi_min: rsiMin, mcap_min_cr: mcapMin, vol_min: volMin });

  try {
    const scriptPath = path.join(process.cwd(), "scripts", "yfinance_backend.py");
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} bridge_screen ${topN} '${filters}'`,
      { timeout: 110000, maxBuffer: 20 * 1024 * 1024 }
    );

    if (stderr) {
      const lines = stderr.split("\n").filter((l) =>
        !l.includes("FutureWarning") &&
        !l.includes("Calling float") &&
        !l.includes("Loaded 750 symbols") &&
        !l.includes("Crumb fetch") &&
        l.trim().length > 0
      );
      if (lines.length > 0) {
        console.error("[bridge-screen] Python stderr:", lines.join("\n").slice(0, 400));
      }
    }

    const data = JSON.parse(stdout);
    return NextResponse.json(data);
  } catch (e: any) {
    console.error("[bridge-screen] Error:", e.message);
    return NextResponse.json(
      {
        error: e.message || "Bridge screen failed",
        universeSize: 0,
        passedData: 0,
        passedTech: 0,
        passedMc: 0,
        top10: [],
        runAt: new Date().toISOString(),
        screenType: "bridge",
      },
      { status: 500 }
    );
  }
}
