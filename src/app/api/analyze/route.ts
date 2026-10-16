// GET /api/analyze?symbol=RELIANCE
import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

  try {
    const scriptPath = path.join(process.cwd(), "scripts", "yfinance_backend.py");
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} analyze ${clean}`,
      { timeout: 25000, maxBuffer: 5 * 1024 * 1024 }
    );

    if (stderr) {
      const lines = stderr.split("\n").filter((l) =>
        !l.includes("FutureWarning") &&
        !l.includes("Calling float") &&
        !l.includes("Loaded 750 symbols") &&
        l.trim().length > 0
      );
      if (lines.length > 0) {
        console.error("[analyze] Python stderr:", lines.join("\n").slice(0, 300));
      }
    }

    const data = JSON.parse(stdout);
    if (data.error) {
      return NextResponse.json(
        {
          error: data.error,
          query: data.query,
          suggestions: data.suggestions || [],
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ...data,
      analyzedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[analyze] Error:", e.message);
    return NextResponse.json(
      { error: e.message || "Failed to analyze stock" },
      { status: 500 }
    );
  }
}
