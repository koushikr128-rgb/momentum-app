// Yahoo Finance client — fetches daily OHLCV for NSE stocks
// Yahoo's chart API endpoint: query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        chartPreviousClose: number;
        symbol: string;
        longName?: string;
        shortName?: string;
      };
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
        adjclose?: Array<{ adjclose: (number | null)[] }>;
      };
      timestamp: number[];
    }>;
    error?: unknown;
  };
}

export interface StockInfo {
  symbol: string;
  marketCap?: number | null;
  sector?: string | null;
  industry?: string | null;
  longName?: string | null;
}

const YF_BASE_PRIMARY = "https://query2.finance.yahoo.com";
const YF_BASE_FALLBACK = "https://query1.finance.yahoo.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

async function yfFetch(path: string): Promise<Response | null> {
  for (const base of [YF_BASE_PRIMARY, YF_BASE_FALLBACK]) {
    try {
      const url = `${base}${path}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json,text/json,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://finance.yahoo.com/",
        },
        cache: "no-store",
        // @ts-expect-error — Next.js fetch extensions
        next: { revalidate: 0 },
      });
      if (res.ok) return res;
      if (res.status === 404) return null;
      if (res.status === 429) {
        // Rate limited — wait longer before trying fallback
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      // network error → try other host
    }
  }
  return null;
}

/**
 * Fetch daily OHLCV for a single NSE symbol (e.g. "RELIANCE" → "RELIANCE.NS").
 * Range: 1.5 years (~390 trading days), interval: 1d.
 */
export async function fetchDailyCandles(
  rawSymbol: string,
  range = "18mo"
): Promise<{ candles: Candle[]; meta: YahooChartResponse["chart"]["result"][0]["meta"] } | null> {
  const symbol = rawSymbol.endsWith(".NS") ? rawSymbol : `${rawSymbol}.NS`;
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await yfFetch(path);
  if (!res) return null;
  try {
    const data = (await res.json()) as YahooChartResponse;
    if (!data?.chart?.result?.[0]) return null;

    const result = data.chart.result[0];
    const q = result.indicators.quote[0];
    const tsArr = result.timestamp;

    const candles: Candle[] = [];
    for (let i = 0; i < tsArr.length; i++) {
      const c = q.close?.[i];
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const v = q.volume?.[i];
      if (c == null || o == null || h == null || l == null || v == null) continue;
      candles.push({
        timestamp: tsArr[i],
        open: o, high: h, low: l, close: c, volume: v,
      });
    }
    if (candles.length < 220) return null;
    return { candles, meta: result.meta };
  } catch {
    return null;
  }
}

/**
 * Batch fetch with concurrency limit + early abort on rate limiting.
 * If we get 3 consecutive 429s, abort early (returning partial results).
 */
export async function batchFetchDailyCandles(
  symbols: string[],
  range = "1y",
  concurrency = 2
): Promise<Map<string, { candles: Candle[]; meta: YahooChartResponse["chart"]["result"][0]["meta"] }>> {
  const result = new Map<string, { candles: Candle[]; meta: YahooChartResponse["chart"]["result"][0]["meta"] }>();
  const queue = [...symbols];
  const workers: Promise<void>[] = [];
  let consecutive429 = 0;
  let aborted = false;

  async function worker() {
    while (queue.length > 0 && !aborted) {
      const sym = queue.shift()!;
      const data = await fetchDailyCandles(sym, range);
      if (data) {
        result.set(sym, data);
        consecutive429 = 0;
      } else {
        consecutive429++;
        // If 5 consecutive failures, abort early (Yahoo is rate-limiting us)
        if (consecutive429 >= 5) {
          aborted = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  for (let i = 0; i < Math.min(concurrency, symbols.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return result;
}

/**
 * Fetch stock info (market cap, sector) via quoteSummary endpoint.
 */
export async function fetchStockInfo(rawSymbol: string): Promise<StockInfo | null> {
  const symbol = rawSymbol.endsWith(".NS") ? rawSymbol : `${rawSymbol}.NS`;
  const path = `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryProfile,price`;
  const res = await yfFetch(path);
  if (!res) return null;
  try {
    const data = await res.json();
    const sp = data?.quoteSummary?.result?.[0]?.summaryProfile;
    const price = data?.quoteSummary?.result?.[0]?.price;
    return {
      symbol,
      marketCap: price?.marketCap ?? null,
      sector: sp?.sector ?? null,
      industry: sp?.industry ?? null,
      longName: price?.longName ?? price?.shortName ?? null,
    };
  } catch {
    return null;
  }
}
