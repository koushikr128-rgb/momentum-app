// POST /api/refresh-prices
// Fetches live LTP for a list of symbols.
// Tries: 1. Zerodha Kite LTP, 2. Python yfinance, 3. Yahoo TS

import { NextResponse } from "next/server";
import { fetchLTP } from "@/lib/kite";
import { batchFetchDailyCandles } from "@/lib/yahoo";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const IS_SANDBOX = !process.env.RENDER_URL && process.env.VERCEL !== "1";

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
        const ltpMap = await fetchLTP(kiteToken, symbols.slice(0, 50));
        for (const [symbol, price] of ltpMap.entries()) {
          const stock = stocks.find((s: any) => s.symbol === symbol);
          const oldPrice = stock?.currentPrice || 0;
          const changePct = oldPrice > 0 ? ((price - oldPrice) / oldPrice) * 100 : 0;
          updatedPrices[symbol] = { price, changePct, source: "zerodha" };
        }
        if (Object.keys(updatedPrices).length > 0) {
          return NextResponse.json({ prices: updatedPrices, source: "zerodha", refreshedAt: new Date().toISOString() });
        }
      } catch (e: any) {
        console.error("[refresh-prices] Zerodha failed:", e.message);
      }
    }

    // 2. Try Python yfinance (sandbox only — bypasses Yahoo rate-limiting)
    if (IS_SANDBOX) {
      try {
        const scriptPath = path.join(process.cwd(), "scripts", "yfinance_backend.py");
        // Use a simple Python one-liner to fetch LTP for all symbols
        const symbolsStr = symbols.join(",");
        const pythonCode = `
import yfinance as yf
import json
symbols = "${symbolsStr}".split(",")
result = {}
for sym in symbols:
    try:
        t = yf.Ticker(f"{sym}.NS")
        h = t.history(period="5d")
        if len(h) > 0:
            result[sym] = float(h['Close'].iloc[-1])
    except:
        pass
print(json.dumps(result))
`;
        const { stdout } = await execAsync(`python3 -c '${pythonCode.replace(/'/g, "'\\''")}'`, { timeout: 20000 });
        const prices = JSON.parse(stdout.trim());
        for (const [sym, price] of Object.entries(prices)) {
          const stock = stocks.find((s: any) => s.symbol === sym);
          const oldPrice = stock?.currentPrice || 0;
          const changePct = oldPrice > 0 ? ((price as number - oldPrice) / oldPrice) * 100 : 0;
          updatedPrices[sym] = { price: price as number, changePct, source: "python" };
        }
        if (Object.keys(updatedPrices).length > 0) {
          return NextResponse.json({ prices: updatedPrices, source: "python", refreshedAt: new Date().toISOString() });
        }
      } catch (e: any) {
        console.error("[refresh-prices] Python failed:", e.message);
      }
    }

    // 3. Fallback: Yahoo TS
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
        return NextResponse.json({ prices: updatedPrices, source: "yahoo", refreshedAt: new Date().toISOString() });
      }
    } catch (e: any) {
      console.error("[refresh-prices] Yahoo failed:", e.message);
    }

    return NextResponse.json({ error: "Could not fetch live prices — all sources failed" }, { status: 502 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
