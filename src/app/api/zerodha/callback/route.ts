// GET /api/zerodha/callback
// Zerodha redirects back here with ?request_token=xxx&status=success
// Exchange request_token for access_token, store in cookie, redirect to dashboard

import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/kite";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestToken = url.searchParams.get("request_token");
  const status = url.searchParams.get("status");

  // Use the origin from headers (works behind proxies like the preview gateway)
  // Falls back to req.url origin if not available
  const origin = req.headers.get("x-forwarded-proto") + "://" + req.headers.get("x-forwarded-host")
    || req.headers.get("origin")
    || new URL(req.url).origin;

  if (status !== "success" || !requestToken) {
    return NextResponse.redirect(`${origin}/?zerodha=error&message=login_failed`);
  }

  try {
    const result = await getAccessToken(requestToken);
    if (!result) {
      return NextResponse.redirect(`${origin}/?zerodha=error&message=token_exchange_failed`);
    }

    // Set access token as an httpOnly cookie
    const response = NextResponse.redirect(
      `${origin}/?zerodha=connected&user=${encodeURIComponent(result.user_name)}`
    );

    // Cookie expires in 1 day (Kite tokens are valid until 6 AM IST next day)
    response.cookies.set("kite_access_token", result.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (e) {
    return NextResponse.redirect(
      `${origin}/?zerodha=error&message=${encodeURIComponent(e instanceof Error ? e.message : "unknown")}`
    );
  }
}
