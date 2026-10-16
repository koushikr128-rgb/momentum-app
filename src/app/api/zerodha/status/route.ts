// GET /api/zerodha/status — check if Kite token is valid
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const API_KEY = process.env.KITE_API_KEY || "mrotfrt78mmjv00p";

export async function GET(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  let accessToken = cookieHeader.match(/kite_access_token=([^;]+)/)?.[1] || "";
  if (!accessToken) {
    accessToken = req.headers.get("x-kite-token") || "";
  }

  if (!accessToken) {
    return NextResponse.json({
      connected: false,
      reason: "no_token",
      message: "No Zerodha access token found. Click Connect Zerodha.",
    });
  }

  try {
    const res = await fetch("https://api.kite.trade/user/profile", {
      headers: {
        "X-Kite-Version": "3",
        Authorization: `token ${API_KEY}:${accessToken}`,
      },
      cache: "no-store",
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({
        connected: true,
        user: data.data?.user_name || data.data?.email || "Zerodha user",
        user_id: data.data?.user_id,
        broker: data.data?.broker,
      });
    }

    if (res.status === 403) {
      return NextResponse.json({
        connected: false,
        reason: "token_expired",
        message: "Zerodha token expired (or revoked). Reconnect to continue.",
      });
    }

    return NextResponse.json({
      connected: false,
      reason: "api_error",
      message: `Kite API returned ${res.status}`,
    });
  } catch (e: any) {
    return NextResponse.json({
      connected: false,
      reason: "network_error",
      message: e.message,
    });
  }
}
