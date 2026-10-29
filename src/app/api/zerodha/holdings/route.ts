// GET /api/zerodha/holdings
// Fetches user's actual Zerodha portfolio holdings
import { NextResponse } from "next/server";
import { fetchHoldings } from "@/lib/kite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const authHeader = req.headers.get("x-kite-token") || "";
  const accessToken = cookieHeader.match(/kite_access_token=([^;]+)/)?.[1] || authHeader;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Zerodha" },
      { status: 401 }
    );
  }

  try {
    const holdings = await fetchHoldings(accessToken);
    const totalPnl = holdings.reduce((a, h) => a + h.pnl, 0);
    const totalInvested = holdings.reduce((a, h) => a + h.averagePrice * h.quantity, 0);
    const totalValue = holdings.reduce((a, h) => a + h.lastPrice * h.quantity, 0);
    const dayChange = holdings.reduce((a, h) => a + h.dayChange, 0);

    return NextResponse.json({
      holdings,
      summary: {
        count: holdings.length,
        totalInvested,
        totalValue,
        totalPnl,
        totalPnlPct: totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0,
        dayChange,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Kite API error" },
      { status: 500 }
    );
  }
}
