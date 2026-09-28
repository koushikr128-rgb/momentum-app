// Technical indicators — RSI(14), moving averages, returns, volatility, Sharpe
import { Candle } from "./yahoo";

export interface StockMetrics {
  symbol: string;
  lastDate: string;
  currentPrice: number;
  dma50: number;
  dma200: number;
  rsi14: number;
  avgVolume30d: number;
  ret1mPct: number;
  ret3mPct: number;
  ret6mPct: number;
  annVolPct: number;
  sharpe: number;
  high52w: number;
  low52w: number;
  pctBelowHigh: number;
  pctAboveLow: number;
  pctAbove200dma: number;
  momentumScore: number;  // 0-100 blended momentum score
}

function sma(values: number[], n: number): number {
  if (values.length < n) return NaN;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function pctStd(values: number[], sample = true): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const ss = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  const denom = sample ? n - 1 : n;
  return Math.sqrt(ss / denom);
}

/**
 * Compute RSI(14) using Wilder's smoothing (EWM alpha = 1/14).
 */
function computeRsi(closes: number[]): number {
  if (closes.length < 15) return 50;
  // Compute deltas
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push(closes[i] - closes[i - 1]);
  }
  // Initial avg gain / loss over first 14 periods
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < 14; i++) {
    if (deltas[i] > 0) avgGain += deltas[i];
    else avgLoss += -deltas[i];
  }
  avgGain /= 14;
  avgLoss /= 14;
  // Wilder smoothing on remaining
  for (let i = 14; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0;
    const loss = deltas[i] < 0 ? -deltas[i] : 0;
    avgGain = (avgGain * 13 + gain) / 14;
    avgLoss = (avgLoss * 13 + loss) / 14;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function computeMetrics(symbol: string, candles: Candle[]): StockMetrics | null {
  if (!candles || candles.length < 220) return null;
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  if (closes.length < 220) return null;

  const currentPrice = closes[closes.length - 1];
  if (!isFinite(currentPrice) || currentPrice <= 0) return null;

  const dma50 = sma(closes, 50);
  const dma200 = sma(closes, 200);
  if (!isFinite(dma50) || !isFinite(dma200)) return null;

  const rsi14 = computeRsi(closes);

  const last30 = vols.slice(-30);
  const avgVolume30d = last30.reduce((a, b) => a + b, 0) / last30.length;

  function ret(n: number): number {
    if (closes.length <= n) return NaN;
    const prev = closes[closes.length - 1 - n];
    if (prev <= 0) return NaN;
    return (currentPrice / prev - 1) * 100;
  }

  const ret1mPct = ret(21);
  const ret3mPct = ret(63);
  const ret6mPct = ret(126);

  // Annualized vol & Sharpe — last 126 daily returns
  const recent = closes.slice(-127);
  const dailyRets: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1] > 0) {
      dailyRets.push(recent[i] / recent[i - 1] - 1);
    }
  }
  let annVolPct = NaN;
  let sharpe = NaN;
  if (dailyRets.length > 20) {
    const volDaily = pctStd(dailyRets);
    annVolPct = volDaily * Math.sqrt(252) * 100;
    const meanDaily = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
    sharpe = volDaily > 0 ? (meanDaily / volDaily) * Math.sqrt(252) : 0;
  }

  // 52W high/low
  const window52w = closes.length >= 252 ? closes.slice(-252) : closes;
  const high52w = Math.max(...window52w);
  const low52w = Math.min(...window52w);
  const pctBelowHigh = high52w > 0 ? (currentPrice / high52w - 1) * 100 : NaN;
  const pctAboveLow = low52w > 0 ? (currentPrice / low52w - 1) * 100 : NaN;
  const pctAbove200dma = dma200 > 0 ? (currentPrice / dma200 - 1) * 100 : NaN;

  // Momentum score (0-100) — weighted blend of:
  //   6M return (40%) — primary momentum signal
  //   3M return (20%) — medium-term
  //   1M return (15%) — recent acceleration
  //   RSI placement (15%) — strength of recent move (60-80 ideal, >80 overbought)
  //   Sharpe (10%) — risk-adjusted quality
  const r6 = clamp(ret6mPct, -50, 200);     // cap at 200%
  const r3 = clamp(ret3mPct, -30, 120);
  const r1 = clamp(ret1mPct, -20, 80);
  const rsiScore = rsi14 > 80 ? 50 - (rsi14 - 80) * 2   // overbought penalty
    : rsi14 < 50 ? rsi14                    // weak
    : 50 + (rsi14 - 50) * 1.5;              // 50-80 → 50-95
  const sharpeScore = clamp(sharpe * 30, 0, 100);

  const momentumScore = clamp(
    0.40 * (r6 / 2 + 25) +    // 6M: 0% → 25, 100% → 75, 200% → 100
    0.20 * (r3 / 2.4 + 25) +  // 3M: 0% → 25, 60% → 50, 120% → 75
    0.15 * (r1 / 1.6 + 25) +  // 1M: 0% → 25, 40% → 50, 80% → 75
    0.15 * rsiScore +
    0.10 * sharpeScore,
    0, 100
  );

  const lastTs = candles[candles.length - 1].timestamp;
  const lastDate = new Date(lastTs * 1000).toISOString().slice(0, 10);

  return {
    symbol,
    lastDate,
    currentPrice,
    dma50,
    dma200,
    rsi14,
    avgVolume30d,
    ret1mPct,
    ret3mPct,
    ret6mPct,
    annVolPct,
    sharpe,
    high52w,
    low52w,
    pctBelowHigh,
    pctAboveLow,
    pctAbove200dma,
    momentumScore,
  };
}

function clamp(v: number, min: number, max: number): number {
  if (isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

export interface ScreenedStock extends StockMetrics {
  longName: string;
  sector: string;
  industry: string;
  marketCapCr: number;
  rank: number;
}

export interface AllocationStock extends ScreenedStock {
  weight: number;
  rupees: number;
  shares: number;
  rsiMultiplier: number;
  notes: string;
}

export interface StopLossStock {
  symbol: string;
  sector: string;
  entryPrice: number;
  currentPrice: number;
  dma50: number;
  peakSinceEntry: number;
  hardStop: number;
  trailingStop: number;
  trendStop: number;
  activeStop: number;
  pnlPct: number;
  pnlRupees: number;
  shares: number;
  rupees: number;
  status: "HOLD" | "WATCH" | "EXIT";
  reasons: string;
}

export interface StressScenario {
  name: string;
  description: string;
  stocksHit: number;
  totalLoss: number;
  newValue: number;
  drawdownPct: number;
  worstStockSymbol: string;
  worstStockLoss: number;
  detail: Array<{
    symbol: string;
    sector: string;
    weight: number;
    rupees: number;
    shockPct: number;
    rupeeLoss: number;
    newValue: number;
  }>;
}
