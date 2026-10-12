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

  if (status !== "success" || !requestToken) {
    return NextResponse.redirect(
      new URL("/?zerodha=error&message=login_failed", req.url)
    );
  }

  try {
    const result = await getAccessToken(requestToken);
    if (!result) {
      return NextResponse.redirect(
        new URL("/?zerodha=error&message=token_exchange_failed", req.url)
      );
    }

    // Set access token as an httpOnly cookie (secure, not accessible by JS)
    // Also store user info in a readable cookie for the UI
    const response = NextResponse.redirect(
      new URL("/?zerodha=connected&user=" + encodeURIComponent(result.user_name), req.url)
    );

    // Cookie expires in 1 day (Kite tokens are valid until 6 AM IST next day)
    response.cookies.set("kite_access_token", result.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60, // 1 day
      path: "/",
    });

    return response;
  } catch (e) {
    return NextResponse.redirect(
      new URL("/?zerodha=error&message=" + encodeURIComponent(e instanceof Error ? e.message : "unknown"), req.url)
    );
  }
}
