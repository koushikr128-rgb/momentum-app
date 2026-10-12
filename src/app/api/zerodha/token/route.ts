// POST /api/zerodha/token
// Manual token entry: user pastes request_token from Kite developer portal
// Body: { request_token: "xxx" }
import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/kite";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const requestToken = body.request_token;
    if (!requestToken) {
      return NextResponse.json({ error: "request_token is required" }, { status: 400 });
    }

    const result = await getAccessToken(requestToken);
    if (!result) {
      return NextResponse.json({ error: "Token exchange failed. Check your API secret." }, { status: 500 });
    }

    const response = NextResponse.json({ success: true, user: result.user_name });
    response.cookies.set("kite_access_token", result.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60,
      path: "/",
    });
    return response;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
