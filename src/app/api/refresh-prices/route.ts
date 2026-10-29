// POST /api/refresh-prices
// Fetches live LTP from Zerodha Kite for a list of symbols.
// Updates the currentPrice field in the screen results without re-running the full screen.
// Falls back to Yahoo LTP if Zerodha not connected.

import { NextResponse } from "next/server";
import { fetchLTP, fetchOHLCQuote } from "@/lib/kite";
import { batchFetchDailyCandles } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { stocks, kiteToken } = await req.json();
    if (!stocks || !Array.isArray(stocks) || stocks.length === 0) {
      return NextResponse.json({ error: "No stocks provided" }, { status: 400 });
    }

    const symbols = stocks.map((s: any) => s.symbol);
    const updatedPrices: Record<string, { price: number; changePct: number; source: string }> = {};

    // 1. Try Zerodha LTP (if token provided)
    if (kiteToken) {
      try {
        const ltpMap = await fetchLTP(kiteToken, symbols.slice(0, 50)); // Kite allows ~50 per call
        for (const [symbol, price] of ltpMap.entries()) {
          const stock = stocks.find((s: any) => s.symbol === symbol);
          const oldPrice = stock?.currentPrice || 0;
          const changePct = oldPrice > 0 ? ((price - oldPrice) / oldPrice) * 100 : 0;
          updatedPrices[symbol] = { price, changePct, source: "zerodha" };
        }
        if (Object.keys(updatedPrices).length > 0) {
          return NextResponse.json({
            prices: updatedPrices,
            source: "zerodha",
            refreshedAt: new Date().toISOString(),
          });
        }
      } catch (e: any) {
        console.error("[refresh-prices] Zerodha failed:", e.message);
      }
    }

    // 2. Fallback: Yahoo LTP (fetch 1-day candles, get last close)
    try {
      const yahooSymbols = symbols.map(s => s.endsWith(".NS") ? s : `${s}.NS`);
      const dataMap = await batchFetchDailyCandles(yahooSymbols, "5d", 1);
      for (const sym of symbols) {
        const key = sym.endsWith(".NS") ? sym : `${sym}.NS`;
        const data = dataMap.get(key);
        if (data && data.candles.length > 0) {
          const price = data.candles[data.candles.length - 1].close;
          const stock = stocks.find((s: any) => s.symbol === sym);
          const oldPrice = stock?.currentPrice || 0;
          const changePct = oldPrice > 0 ? ((price - oldPrice) / oldPrice) * 100 : 0;
          updatedPrices[sym] = { price, changePct, source: "yahoo" };
        }
      }
      if (Object.keys(updatedPrices).length > 0) {
        return NextResponse.json({
          prices: updatedPrices,
          source: "yahoo",
          refreshedAt: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      console.error("[refresh-prices] Yahoo failed:", e.message);
    }

    return NextResponse.json({ error: "Could not fetch live prices" }, { status: 502 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
