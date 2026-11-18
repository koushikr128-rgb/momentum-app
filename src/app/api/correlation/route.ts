// POST /api/correlation
// Body: { allocation: AllocationStock[] }
// Returns: { matrix, effectiveBets, highCorrelationPairs, avgCorrelation, nDataPoints }
// Spawns Python backend that fetches 6mo OHLCV + computes pairwise correlation

import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { AllocationStock } from "@/lib/indicators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PYTHON = "/usr/bin/python3";
const SCRIPT = "/home/z/my-project/scripts/correlation_backend.py";
const PY_ENV = { ...process.env, PYTHONPATH: "/home/z/my-project/pylibs" };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const alloc = body.allocation as AllocationStock[];
    if (!Array.isArray(alloc) || alloc.length < 2) {
      return NextResponse.json(
        { error: "At least 2 holdings are required for correlation" },
        { status: 400 }
      );
    }

    const symbols = alloc.map((a) => a.symbol);
    const payload = JSON.stringify({ symbols });

    const result = await new Promise<string>((resolve, reject) => {
      const py = spawn(PYTHON, [SCRIPT], { env: PY_ENV });
      let stdout = "";
      let stderr = "";
      py.stdin.write(payload);
      py.stdin.end();
      py.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      py.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      py.on("close", (code: number) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Backend exited ${code}: ${stderr.slice(-500)}`));
      });
      py.on("error", (err: Error) => reject(err));
    });

    const lastLine = result.trim().split("\n").pop() || "{}";
    const data = JSON.parse(lastLine);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
