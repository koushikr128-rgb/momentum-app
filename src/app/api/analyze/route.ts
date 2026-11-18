// GET /api/analyze?symbol=RELIANCE
// Tries Render backend first, falls back to local Python.

import { NextResponse } from "next/server";
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
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();

  if (!symbol) {
    return NextResponse.json(
      { error: "Symbol is required. Example: /api/analyze?symbol=RELIANCE" },
      { status: 400 }
    );
  }

  const clean = symbol.replace(/\.NS$/i, "").replace(/[^A-Z0-9\-]/g, "");
  if (!clean || clean.length < 1 || clean.length > 30) {
    return NextResponse.json({ error: "Invalid symbol format" }, { status: 400 });
  }

  // 1. Try Render backend
  if (RENDER_URL) {
    try {
      const res = await fetch(`${RENDER_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: clean }),
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.error) {
          return NextResponse.json(
            { error: data.error, query: data.query, suggestions: data.suggestions || [] },
            { status: 404 }
          );
        }
        return NextResponse.json({ ...data, analyzedAt: new Date().toISOString() });
      }
    } catch {}
  }

  // 2. Local Python (sandbox only)
  if (IS_SANDBOX) {
    try {
      const scriptPath = path.join(process.cwd(), "scripts", "yfinance_backend.py");
      const { stdout } = await execAsync(
        `python3 ${scriptPath} analyze ${clean}`,
        { timeout: 25000, maxBuffer: 5 * 1024 * 1024, env: { ...process.env, PYTHONPATH: "/home/z/my-project/pylibs" } }
      );
      const data = JSON.parse(stdout);
      if (data.error) {
        return NextResponse.json(
          { error: data.error, query: data.query, suggestions: data.suggestions || [] },
          { status: 404 }
        );
      }
      return NextResponse.json({ ...data, analyzedAt: new Date().toISOString() });
    } catch (e: any) {
      console.error("[analyze] Error:", e.message);
    }
  }

  return NextResponse.json(
    { error: "Failed to analyze stock — no backend available" },
    { status: 500 }
  );
}
