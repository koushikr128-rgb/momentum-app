// GET /api/zerodha/callback
// Zerodha redirects here with ?request_token=xxx&status=success
// We redirect to the dashboard root with the token as a query param
// The dashboard reads it and shows it in the Zerodha dialog

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestToken = url.searchParams.get("request_token");
  const status = url.searchParams.get("status");

  // Get the origin from headers (works behind the preview gateway)
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const origin = `${proto}://${host}`;

  if (status !== "success" || !requestToken) {
    return NextResponse.redirect(`${origin}/?zerodha=error`);
  }

  // Redirect to dashboard with the token — the UI will detect it and auto-connect
  return NextResponse.redirect(`${origin}/?zerodha=token&request_token=${encodeURIComponent(requestToken)}`);
}
