// Yahoo Finance batch quote client — fetches multiple symbols in ONE HTTP call
// Uses the v7/quote endpoint with crumb authentication.
// Schema validated with Zod per the ScreenerQuoteSchema provided by the user.
//
// This replaces the Python yfinance backend — pure TypeScript, deploys anywhere.

import { z } from "zod";

export const ScreenerQuoteSchema = z.object({
  language: z.string().optional(),
  region: z.string().optional(),
  quoteType: z.string().optional(),
  typeDisp: z.string().optional(),
  quoteSourceName: z.string().optional(),
  triggerable: z.boolean().optional(),
  customPriceAlertConfidence: z.string().optional(),
  lastClosePriceToNNWCPerShare: z.number().optional(),
  exchange: z.string().optional(),
  fiftyTwoWeekHigh: z.number().optional(),
  fiftyTwoWeekLow: z.number().optional(),
  averageAnalystRating: z.string().optional(),
  shortName: z.string().optional(),
  currency: z.string().optional(),
  hasPrePostMarketData: z.boolean().optional(),
  firstTradeDateMilliseconds: z.number().optional(),
  priceHint: z.number().optional(),
  preMarketChange: z.number().optional(),
  preMarketChangePercent: z.number().optional(),
  preMarketTime: z.number().optional(),
  preMarketPrice: z.number().optional(),
  regularMarketChange: z.number().optional(),
  regularMarketTime: z.number().optional(),
  regularMarketPrice: z.number().optional(),
  regularMarketDayHigh: z.number().optional(),
  regularMarketDayRange: z.any().optional(),
  regularMarketDayLow: z.number().optional(),
  regularMarketVolume: z.number().optional(),
  regularMarketPreviousClose: z.number().optional(),
  bid: z.number().optional(),
  ask: z.number().optional(),
  bidSize: z.number().optional(),
  askSize: z.number().optional(),
  market: z.string().optional(),
  messageBoardId: z.string().optional(),
  fullExchangeName: z.string().optional(),
  longName: z.string().default("N/A"),
  financialCurrency: z.string().optional(),
  regularMarketOpen: z.number().optional(),
  averageDailyVolume3Month: z.number().optional(),
  averageDailyVolume10Day: z.number().optional(),
  corporateActions: z.array(z.unknown()).optional(),
  fiftyTwoWeekLowChange: z.number().optional(),
  fiftyTwoWeekLowChangePercent: z.number().optional(),
  fiftyTwoWeekRange: z.any().optional(),
  fiftyTwoWeekHighChange: z.number().optional(),
  fiftyTwoWeekHighChangePercent: z.number().optional(),
  fiftyTwoWeekChangePercent: z.number().optional(),
  earningsTimestamp: z.number().optional(),
  earningsTimestampStart: z.number().optional(),
  earningsTimestampEnd: z.number().optional(),
  earningsCallTimestampStart: z.number().optional(),
  earningsCallTimestampEnd: z.number().optional(),
  isEarningsDateEstimate: z.boolean().optional(),
  trailingAnnualDividendRate: z.number().optional(),
  trailingAnnualDividendYield: z.number().optional(),
  marketState: z.string().optional(),
  priceEpsCurrentYear: z.number().optional(),
  sharesOutstanding: z.number().optional(),
  bookValue: z.number().optional(),
  fiftyDayAverage: z.number().optional(),
  fiftyDayAverageChange: z.number().optional(),
  fiftyDayAverageChangePercent: z.number().optional(),
  twoHundredDayAverage: z.number().optional(),
  twoHundredDayAverageChange: z.number().optional(),
  twoHundredDayAverageChangePercent: z.number().optional(),
  marketCap: z.number().optional(),
  forwardPE: z.number().optional(),
  priceToBook: z.number().optional(),
  sourceInterval: z.number().optional(),
  exchangeDataDelayedBy: z.number().optional(),
  exchangeTimezoneName: z.string().optional(),
  exchangeTimezoneShortName: z.string().optional(),
  gmtOffSetMilliseconds: z.number().optional(),
  prevName: z.string().optional(),
  nameChangeDate: z.string().optional(),
  esgPopulated: z.boolean().optional(),
  tradeable: z.boolean().optional(),
  cryptoTradeable: z.boolean().optional(),
  epsTrailingTwelveMonths: z.number().optional(),
  epsForward: z.number().optional(),
  epsCurrentYear: z.number().optional(),
  regularMarketChangePercent: z.number().optional(),
  displayName: z.string().default("N/A"),
  symbol: z.string(),
});

export const ScreenerQuotesSchema = z.array(ScreenerQuoteSchema);

export type ScreenerQuote = z.infer<typeof ScreenerQuoteSchema>;
export type ScreenerQuotes = z.infer<typeof ScreenerQuotesSchema>;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

// Crumb cache — fetched once per session, reused for all batch calls
let cachedCrumb: { crumb: string; cookie: string; fetchedAt: number } | null = null;
const CRUMB_TTL_MS = 30 * 60 * 1000;

/**
 * Fetch a crumb + cookie from Yahoo Finance.
 * Key: must visit fc.yahoo.com (NOT www.yahoo.com) with redirect: "manual"
 * to get the A3/A1 session cookies needed for the crumb endpoint.
 * Caches the result for 30 minutes.
 */
async function fetchCrumb(): Promise<{ crumb: string; cookie: string }> {
  if (cachedCrumb && Date.now() - cachedCrumb.fetchedAt < CRUMB_TTL_MS) {
    return { crumb: cachedCrumb.crumb, cookie: cachedCrumb.cookie };
  }

  // Step 1: Visit fc.yahoo.com to get session cookies (returns 404 but sets cookies)
  const homeRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": USER_AGENT },
    redirect: "manual",
    cache: "no-store",
  });
  const cookie = homeRes.headers.get("set-cookie") || "";

  if (!cookie) {
    throw new Error("No cookies received from Yahoo");
  }

  // Step 2: Get crumb using the cookies
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": USER_AGENT,
      Cookie: cookie,
    },
    cache: "no-store",
  });
  const crumb = (await crumbRes.text()).trim();

  if (!crumb || crumb.startsWith("{")) {
    throw new Error("Failed to fetch Yahoo crumb: " + crumb.slice(0, 100));
  }

  cachedCrumb = { crumb, cookie, fetchedAt: Date.now() };
  return { crumb, cookie };
}

/**
 * Fetch quotes for multiple symbols in ONE HTTP call.
 * Returns a Map keyed by symbol (without .NS suffix).
 *
 * Batch size: Yahoo supports up to ~50 symbols per call.
 * If more than 50 symbols are passed, they're split into multiple batches.
 */
export async function fetchBatchQuotes(symbols: string[]): Promise<Map<string, ScreenerQuote>> {
  const result = new Map<string, ScreenerQuote>();
  if (symbols.length === 0) return result;

  const { crumb, cookie } = await fetchCrumb();
  const BATCH_SIZE = 50;

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const symbolsParam = batch.map((s) => (s.endsWith(".NS") ? s : `${s}.NS`)).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbolsParam)}&crumb=${encodeURIComponent(crumb)}`;

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Cookie: cookie,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (!res.ok) continue;

      const data = await res.json();
      const quotes = data?.quoteResponse?.result || [];

      for (const q of quotes) {
        try {
          const parsed = ScreenerQuoteSchema.parse(q);
          const sym = parsed.symbol.replace(".NS", "");
          result.set(sym, parsed);
        } catch {
          // Skip invalid quotes
        }
      }
    } catch {
      continue;
    }
  }

  return result;
}
