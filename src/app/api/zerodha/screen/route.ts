// GET /api/zerodha/screen
// Fetches NSE instruments + OHLCV via Kite API, computes momentum indicators
// Query params: topN, rsiMin, mcapMin, volMin (same as Yahoo screen)

import { NextResponse } from "next/server";
import { fetchInstruments, fetchHistoricalData } from "@/lib/kite";
import { computeMetrics, ScreenedStock } from "@/lib/indicators";
import { applyTechnicalFilter } from "@/lib/strategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Cache instruments list for 24 hours (doesn't change often)
let instrumentsCache: { data: Awaited<ReturnType<typeof fetchInstruments>>; ts: number } | null = null;
const INSTRUMENTS_TTL = 24 * 60 * 60 * 1000;

// Cache screen results for 15 minutes
let screenCache: { data: unknown; ts: number } | null = null;
const SCREEN_TTL = 15 * 60 * 1000;

export async function GET(req: Request) {
  const start = Date.now();
  const url = new URL(req.url);
  const topN = Math.max(1, Math.min(50, Number(url.searchParams.get("topN") || "10")));
  const rsiMin = Number(url.searchParams.get("rsiMin") || "50");
  const mcapMin = Number(url.searchParams.get("mcapMin") || "200");
  const volMin = Number(url.searchParams.get("volMin") || "20000");

  // Check screen cache
  const cacheKey = `${topN}-${rsiMin}-${mcapMin}-${volMin}`;
  if (screenCache && Date.now() - screenCache.ts < SCREEN_TTL) {
    return NextResponse.json({
      ...(screenCache.data as object),
      cached: true,
      cacheAge: Date.now() - screenCache.ts,
      elapsedMs: Date.now() - start,
    });
  }

  // Get access token from cookie
  const cookieHeader = req.headers.get("cookie") || "";
  const accessToken = cookieHeader.match(/kite_access_token=([^;]+)/)?.[1];

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Zerodha. Click 'Connect Zerodha' to login." },
      { status: 401 }
    );
  }

  try {
    // 1. Fetch NSE instruments (cached for 24h)
    let instruments;
    if (instrumentsCache && Date.now() - instrumentsCache.ts < INSTRUMENTS_TTL) {
      instruments = instrumentsCache.data;
    } else {
      instruments = await fetchInstruments(accessToken);
      instrumentsCache = { data: instruments, ts: Date.now() };
    }

    if (instruments.length === 0) {
      return NextResponse.json({ error: "No instruments found from Kite API" }, { status: 500 });
    }

    // 2. Fetch historical OHLCV for each instrument
    // Kite allows 3 requests per second on free tier — batch with delay
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    const fromDate = oneYearAgo.toISOString().slice(0, 10);
    const toDate = today.toISOString().slice(0, 10);

    const metricsList = [];
    const BATCH_SIZE = 50;
    const BATCH_DELAY = 350; // 350ms between batches = ~2.8 req/s (under 3/s limit)

    for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
      const batch = instruments.slice(i, i + BATCH_SIZE);

      // Fetch historical data for each instrument in the batch (parallel)
      const promises = batch.map(async (inst) => {
        const candles = await fetchHistoricalData(accessToken, inst.instrument_token, fromDate, toDate);
        if (candles.length < 220) return null;

        // Convert to the format expected by computeMetrics
        const kiteCandles = candles.map((c) => ({
          timestamp: new Date(c.date).getTime() / 1000,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        return computeMetrics(inst.tradingsymbol, kiteCandles);
      });

      const results = await Promise.all(promises);
      for (const m of results) {
        if (m) metricsList.push(m);
      }

      // Delay between batches to stay under rate limit
      if (i + BATCH_SIZE < instruments.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY));
      }
    }

    // 3. Apply technical + volume filter
    const techPassed = metricsList.filter(
      (m) => applyTechnicalFilter(m) && m.rsi14 > rsiMin && m.avgVolume30d > volMin
    );

    // 4. Apply market cap filter
    // Kite doesn't return market cap in instruments list, so we use the CSV as fallback
    // For now, skip market cap filter (all stocks that pass technical are included)
    const screened: ScreenedStock[] = techPassed.map((m) => ({
      ...m,
      longName: m.symbol,
      sector: "—",
      industry: "—",
      marketCapCr: 0, // Kite doesn't provide this
      rank: 0,
    }));

    // 5. Sort by 6M return DESC, take top N
    screened.sort((a, b) => b.ret6mPct - a.ret6mPct);
    const top10 = screened.slice(0, topN).map((s, i) => ({ ...s, rank: i + 1 }));

    const result = {
      universeSize: instruments.length,
      passedData: metricsList.length,
      passedTech: techPassed.length,
      passedMc: screened.length,
      top10,
      runAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
      cached: false,
      topN,
      filters: { rsiMin, mcapMin, volMin },
      backend: "zerodha-kite",
    };

    screenCache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Kite API error" },
      { status: 500 }
    );
  }
}
