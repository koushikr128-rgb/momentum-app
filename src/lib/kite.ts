// Zerodha Kite Connect client
// Docs: https://kite.trade/docs/connect/v3/
//
// Flow:
// 1. User clicks "Connect Zerodha" → redirect to Kite login
// 2. User logs in on Zerodha → Kite redirects back with request_token
// 3. App exchanges request_token + api_secret for access_token
// 4. access_token stored in localStorage (session-level)
// 5. All subsequent API calls use the access_token

const KITE_BASE = "https://api.kite.trade";
const KITE_LOGIN_URL = "https://kite.zerodha.com/connect/login";

// API credentials — stored in .env on Vercel, hardcoded for sandbox
const API_KEY = process.env.KITE_API_KEY || "mrotfrt78mmjv00p";
const API_SECRET = process.env.KITE_API_SECRET || "";
export const REDIRECT_URI =
  process.env.KITE_REDIRECT_URI ||
  "https://preview-1fd75aa3-09a0-4ed0-80d6-1be7478b89a2.space-z.ai/api/zerodha/callback";

/**
 * Generate the Kite login URL for OAuth redirect.
 * User clicks this → logs in on Zerodha → redirected back with request_token.
 */
export function getKiteLoginUrl(): string {
  const params = new URLSearchParams({
    api_key: API_KEY,
    v: "3",
  });
  // Kite requires the redirect URL to match what's registered in the app settings
  // It's sent as part of the login URL to avoid "Missing or empty field `authorize`" error
  return `${KITE_LOGIN_URL}?${params}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
}

/**
 * Exchange request_token for access_token.
 * Called after Zerodha redirects back with ?request_token=xxx&status=success
 */
export async function getAccessToken(requestToken: string): Promise<{
  access_token: string;
  user_id: string;
  user_name: string;
} | null> {
  if (!API_SECRET) {
    throw new Error("KITE_API_SECRET not set");
  }

  // Kite uses API key + request token + API secret for auth
  // The checksum is SHA256(api_key + request_token + api_secret)
  const { createHash } = await import("crypto");
  const checksum = createHash("sha256")
    .update(API_KEY + requestToken + API_SECRET)
    .digest("hex");

  const res = await fetch(`${KITE_BASE}/session/token`, {
    method: "POST",
    headers: {
      "X-Kite-Version": "3",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      api_key: API_KEY,
      request_token: requestToken,
      checksum,
    }),
  });

  if (!res.ok) {
    console.error("[kite] Token exchange failed:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  return {
    access_token: data.data.access_token,
    user_id: data.data.user_id,
    user_name: data.data.user_name,
  };
}

/**
 * Fetch all NSE instruments (stock list).
 * Returns: Array of { instrument_token, tradingsymbol, name, exchange, segment, market_cap (if available) }
 * This replaces the CSV upload — always up-to-date.
 */
export async function fetchInstruments(accessToken: string): Promise<
  Array<{
    instrument_token: number;
    tradingsymbol: string;
    name: string;
    exchange: string;
    segment: string;
  }>
> {
  const res = await fetch(`${KITE_BASE}/instruments`, {
    headers: {
      "X-Kite-Version": "3",
      Authorization: `token ${API_KEY}:${accessToken}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    console.error("[kite] Instruments fetch failed:", res.status);
    return [];
  }

  const data = await res.json();
  // Filter to NSE stocks only (exclude F&O, ETFs, etc.)
  return (data.data || [])
    .filter((inst: { exchange: string; segment: string; instrument_type: string }) =>
      inst.exchange === "NSE" && inst.segment === "EQ" && inst.instrument_type === "EQ"
    )
    .map((inst: { instrument_token: number; tradingsymbol: string; name: string; exchange: string; segment: string }) => ({
      instrument_token: inst.instrument_token,
      tradingsymbol: inst.tradingsymbol,
      name: inst.name,
      exchange: inst.exchange,
      segment: inst.segment,
    }));
}

/**
 * Fetch historical OHLCV data for a single instrument.
 * Returns: Array of { date, open, high, low, close, volume }
 *
 * Kite allows 2000 candles per request. For 1 year of daily data (~252 candles),
 * one request per stock is enough.
 */
export async function fetchHistoricalData(
  accessToken: string,
  instrumentToken: number,
  fromDate: string,
  toDate: string
): Promise<Array<{
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>> {
  const params = new URLSearchParams({
    instrument_token: String(instrumentToken),
    interval: "day",
    from: fromDate,
    to: toDate,
  });

  const res = await fetch(`${KITE_BASE}/instruments/historical/${instrumentToken}/day?${params}`, {
    headers: {
      "X-Kite-Version": "3",
      Authorization: `token ${API_KEY}:${accessToken}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    return [];
  }

  const data = await res.json();
  return (data.data?.candles || []).map((c: (string | number)[]) => ({
    date: c[0] as string,
    open: c[1] as number,
    high: c[2] as number,
    low: c[3] as number,
    close: c[4] as number,
    volume: c[5] as number,
  }));
}

/**
 * Fetch LTP (Last Traded Price) for multiple instruments.
 * Returns: Map of tradingsymbol → { last_price, ... }
 */
export async function fetchLTP(
  accessToken: string,
  instruments: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  // Kite LTP API takes instrument keys as "NSE:RELIANCE,NSE:TCS,..."
  const iParams = instruments.map((s) => `NSE:${s}`).join(",");

  const res = await fetch(`${KITE_BASE}/quote/ltp?i=${encodeURIComponent(iParams)}`, {
    headers: {
      "X-Kite-Version": "3",
      Authorization: `token ${API_KEY}:${accessToken}`,
    },
    cache: "no-store",
  });

  if (!res.ok) return result;

  const data = await res.json();
  for (const [key, val] of Object.entries(data.data || {})) {
    const symbol = key.replace("NSE:", "");
    result.set(symbol, (val as { last_price: number }).last_price);
  }
  return result;
}
