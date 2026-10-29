// GET /api/zerodha/diagnose
// Diagnostic endpoint — calls Kite's user/profile, instruments, and historical data APIs
// and returns the raw responses. Used to debug "Kite connect works but X fails" issues.

import { NextResponse } from "next/server";
import { diagnoseHistorical } from "@/lib/kite";

export const runtime = "nodejs";

const API_KEY = process.env.KITE_API_KEY || "mrotfrt78mmjv00p";
const KITE_BASE = "https://api.kite.trade";

export async function GET(req: Request) {
  // Try cookie first
  const cookieHeader = req.headers.get("cookie") || "";
  let accessToken = cookieHeader.match(/kite_access_token=([^;]+)/)?.[1] || "";
  if (!accessToken) {
    accessToken = req.headers.get("x-kite-token") || "";
  }

  if (!accessToken) {
    return NextResponse.json({
      error: "No access token. Connect Zerodha first.",
      steps: ["user/profile: skipped", "instruments: skipped", "historical: skipped"],
    });
  }

  const out: any = { accessToken: accessToken.slice(0, 8) + "…" };

  // 1) Profile
  try {
    const r1 = await fetch(`${KITE_BASE}/user/profile`, {
      headers: { "X-Kite-Version": "3", Authorization: `token ${API_KEY}:${accessToken}` },
      cache: "no-store",
    });
    out.profile = { status: r1.status, body: (await r1.text()).slice(0, 500) };
  } catch (e: any) {
    out.profile = { error: e.message };
  }

  // 2) Instruments (just check first 200 chars — full list is huge)
  try {
    const r2 = await fetch(`${KITE_BASE}/instruments`, {
      headers: { "X-Kite-Version": "3", Authorization: `token ${API_KEY}:${accessToken}` },
      cache: "no-store",
    });
    const body = await r2.text();
    out.instruments = { status: r2.status, bodyPreview: body.slice(0, 300), contentLength: body.length };
  } catch (e: any) {
    out.instruments = { error: e.message };
  }

  // 3) Historical for NIFTY 50 (instrument_token = 256265)
  out.historical = await diagnoseHistorical(accessToken, 256265);

  // 4) Quote LTP for NIFTY 50 BEES (sanity check)
  try {
    const r4 = await fetch(`${KITE_BASE}/quote/ltp?i=NSE:RELIANCE`, {
      headers: { "X-Kite-Version": "3", Authorization: `token ${API_KEY}:${accessToken}` },
      cache: "no-store",
    });
    out.ltp = { status: r4.status, body: (await r4.text()).slice(0, 300) };
  } catch (e: any) {
    out.ltp = { error: e.message };
  }

  return NextResponse.json(out, { status: 200 });
}
