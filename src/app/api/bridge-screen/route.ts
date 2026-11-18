// GET /api/bridge-screen?topN=10&rsiMin=50&mcapMin=200&volMin=20000
// Pullback Bridge Screener — tries Render backend first, falls back to local Python.

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RENDER_URL = process.env.RENDER_URL || "";
const IS_SANDBOX = !RENDER_URL && process.env.VERCEL !== "1";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const topN = Math.max(1, Math.min(50, Number(url.searchParams.get("topN") || "10")));
  const rsiMin = Number(url.searchParams.get("rsiMin") || "50");
  const mcapMin = Number(url.searchParams.get("mcapMin") || "200");
  const volMin = Number(url.searchParams.get("volMin") || "20000");

  const filters = { rsi_min: rsiMin, mcap_min_cr: mcapMin, vol_min: volMin };

  // 1. Try Render backend
  if (RENDER_URL) {
    try {
      const res = await fetch(`${RENDER_URL}/bridge-screen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topN, filters }),
        cache: "no-store",
        signal: AbortSignal.timeout(55000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {}
  }

  // 2. Local Python (sandbox only)
  if (IS_SANDBOX) {
    try {
      const scriptPath = path.join(process.cwd(), "scripts", "yfinance_backend.py");
      const { stdout, stderr } = await execAsync(
        `python3 ${scriptPath} bridge_screen ${topN} '${JSON.stringify(filters)}'`,
        { timeout: 110000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, PYTHONPATH: "/home/z/my-project/pylibs" } }
      );
      const data = JSON.parse(stdout);
      return NextResponse.json(data);
    } catch (e: any) {
      console.error("[bridge-screen] Error:", e.message);
    }
  }

  return NextResponse.json(
    {
      error: "Bridge screen failed — no backend available",
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
