// GET /api/sparklines?symbols=RELIANCE,TCS,INFY
// Returns 30-day closing prices for each symbol — used for mini sparkline charts

import { NextResponse } from "next/server";
import { batchFetchDailyCandles } from "@/lib/yahoo";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const IS_SANDBOX = !process.env.RENDER_URL && process.env.VERCEL !== "1";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols") || "";
  const symbols = symbolsParam.split(",").filter(Boolean).map(s => s.trim().toUpperCase()).slice(0, 50);

  if (symbols.length === 0) {
    return NextResponse.json({ error: "No symbols provided" }, { status: 400 });
  }

  // 1. Try Python yfinance (sandbox — bypasses Yahoo rate-limiting)
  if (IS_SANDBOX) {
    try {
      const symbolsStr = symbols.join(",");
      const pythonCode = `
import yfinance as yf
import json
symbols = "${symbolsStr}".split(",")
result = {}
tickers = [f"{s}.NS" for s in symbols]
data = yf.download(tickers, period="1mo", interval="1d", progress=False, threads=True, group_by="ticker")
for sym in symbols:
    try:
        if len(tickers) > 1:
            df = data[sym + ".NS"]["Close"].squeeze().dropna()
        else:
            df = data["Close"].squeeze().dropna()
        if len(df) > 5:
            result[sym] = [float(x) for x in df.tail(30).values]
    except:
        pass
print(json.dumps(result))
`;
      const { stdout } = await execAsync(`python3 -c '${pythonCode.replace(/'/g, "'\\''")}'`, { timeout: 25000 });
      const sparklines = JSON.parse(stdout.trim());
      if (Object.keys(sparklines).length > 0) {
        return NextResponse.json({ sparklines, source: "python" });
      }
    } catch (e: any) {
      console.error("[sparklines] Python failed:", e.message);
    }
  }

  // 2. Fallback: Yahoo TS
  try {
    const yahooSymbols = symbols.map(s => s.endsWith(".NS") ? s : `${s}.NS`);
    const dataMap = await batchFetchDailyCandles(yahooSymbols, "1mo", 1);

    if (dataMap.size > 0) {
      const result: Record<string, number[]> = {};
      for (const sym of symbols) {
        const key = sym.endsWith(".NS") ? sym : `${sym}.NS`;
        const data = dataMap.get(key);
        if (data && data.candles.length > 5) {
          const closes = data.candles.slice(-30).map(c => c.close);
          result[sym] = closes;
        }
      }
      if (Object.keys(result).length > 0) {
        return NextResponse.json({ sparklines: result, source: "yahoo" });
      }
    }
  } catch {}

  return NextResponse.json({ sparklines: {}, source: "none" });
}
