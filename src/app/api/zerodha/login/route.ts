// GET /api/zerodha/login
// Redirects user to Zerodha Kite login page for OAuth
import { NextResponse } from "next/server";
import { getKiteLoginUrl } from "@/lib/kite";

export const runtime = "nodejs";

export async function GET() {
  const loginUrl = getKiteLoginUrl();
  return NextResponse.redirect(loginUrl);
}
