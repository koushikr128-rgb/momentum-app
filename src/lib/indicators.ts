// Technical indicators — RSI(14), moving averages, returns, volatility, Sharpe
// + Phase 1: SetupType, SetupGrade, SignalScore, Trade Plan, VSA, BB width
import { Candle } from "./yahoo";

export type SetupType =
  | "BREAKOUT"
  | "PULLBACK"
  | "TIGHTENING"
  | "EXTENDED"
  | "DISTRIBUTION"
  | "UPTREND";

export type SetupGrade = "A+" | "A" | "B" | "C";

export interface StockMetrics {
  symbol: string;
  lastDate: string;
  currentPrice: number;
  dma50: number;
  dma200: number;
  dma20: number;
  rsi14: number;
  avgVolume30d: number;
  ret1mPct: number;
  ret1wPct: number;
  ret3mPct: number;
  ret6mPct: number;
  annVolPct: number;
  sharpe: number;
  high52w: number;
  low52w: number;
  pctBelowHigh: number;
  pctAboveLow: number;
  pctAbove200dma: number;
  momentumScore: number;
  signalScore: number;
  setupType: SetupType;
  setupGrade: SetupGrade;
  entryPrice: number;
  addPrice: number;
  stopPrice: number;
  target1: number;
  target2: number;
  riskReward: number;
  volMult: number;
  pctAbove20dma: number;
  vsaTag: "ACCUM" | "DIST" | "NEUTRAL";
  bollingerWidth: number;
  bbWidth6mPct: number;
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

function computeRsi(closes: number[]): number {
  if (closes.length < 15) return 50;
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push(closes[i] - closes[i - 1]);
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < 14; i++) {
    if (deltas[i] > 0) avgGain += deltas[i];
    else avgLoss += -deltas[i];
  }
  avgGain /= 14;
  avgLoss /= 14;
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
  const dma20 = sma(closes, 20);
  if (!isFinite(dma50) || !isFinite(dma200) || !isFinite(dma20)) return null;

  const rsi14 = computeRsi(closes);

  const last30 = vols.slice(-30);
  const avgVolume30d = last30.reduce((a, b) => a + b, 0) / last30.length;

  function ret(n: number): number {
    if (closes.length <= n) return NaN;
    const prev = closes[closes.length - 1 - n];
    if (prev <= 0) return NaN;
    return (currentPrice / prev - 1) * 100;
  }

  const ret1wPct = ret(5);
  const ret1mPct = ret(21);
  const ret3mPct = ret(63);
  const ret6mPct = ret(126);

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

  const window52w = closes.length >= 252 ? closes.slice(-252) : closes;
  const high52w = Math.max(...window52w);
  const low52w = Math.min(...window52w);
  const pctBelowHigh = high52w > 0 ? (currentPrice / high52w - 1) * 100 : NaN;
  const pctAboveLow = low52w > 0 ? (currentPrice / low52w - 1) * 100 : NaN;
  const pctAbove200dma = dma200 > 0 ? (currentPrice / dma200 - 1) * 100 : NaN;
  const pctAbove20dma = dma20 > 0 ? (currentPrice / dma20 - 1) * 100 : NaN;

  // Legacy momentum score
  const r6 = clamp(ret6mPct, -50, 200);
  const r3 = clamp(ret3mPct, -30, 120);
  const r1 = clamp(ret1mPct, -20, 80);
  const rsiScore = rsi14 > 80 ? 50 - (rsi14 - 80) * 2
    : rsi14 < 50 ? rsi14
    : 50 + (rsi14 - 50) * 1.5;
  const sharpeScore = clamp(sharpe * 30, 0, 100);

  const momentumScore = clamp(
    0.40 * (r6 / 2 + 25) +
    0.20 * (r3 / 2.4 + 25) +
    0.15 * (r1 / 1.6 + 25) +
    0.15 * rsiScore +
    0.10 * sharpeScore,
    0, 100
  );

  // ===== Setup Classification =====
  const last50vols = vols.slice(-50);
  const avgVol50 = last50vols.reduce((a, b) => a + b, 0) / Math.max(last50vols.length, 1);
  const lastVol = vols[vols.length - 1] || 0;
  const volMult = avgVol50 > 0 ? lastVol / avgVol50 : 1;

  const last20 = closes.slice(-20);
  const mean20 = last20.reduce((a, b) => a + b, 0) / last20.length;
  const std20 = pctStd(last20);
  const upperBB = mean20 + 2 * std20;
  const lowerBB = mean20 - 2 * std20;
  const bollingerWidth = mean20 > 0 ? (upperBB - lowerBB) / mean20 * 100 : 0;

  const bbWidths6m: number[] = [];
  const lookback6m = Math.min(closes.length - 20, 126);
  for (let i = 0; i < lookback6m; i += 5) {
    const start = closes.length - 20 - lookback6m + i;
    if (start < 0) break;
    const win = closes.slice(start, start + 20);
    if (win.length === 20) {
      const m = win.reduce((a, b) => a + b, 0) / 20;
      const s = pctStd(win);
      if (m > 0) bbWidths6m.push((m + 2 * s - (m - 2 * s)) / m * 100);
    }
  }
  const bbWidth6mPct = bbWidths6m.length > 0
    ? (bbWidths6m.filter(w => w <= bollingerWidth).length / bbWidths6m.length) * 100
    : 50;

  const last20High = Math.max(...closes.slice(-21, -1));
  const last20Low = Math.min(...closes.slice(-21, -1));

  const lastOpen = candles[candles.length - 1].open;
  const lastClose = candles[candles.length - 1].close;
  const isUpDay = lastClose >= lastOpen;
  const vsaTag: "ACCUM" | "DIST" | "NEUTRAL" =
    volMult > 1.3 && isUpDay ? "ACCUM"
    : volMult > 1.3 && !isUpDay ? "DIST"
    : "NEUTRAL";

  const isUptrend = currentPrice > dma50 && dma50 > dma200;
  const isExtended = rsi14 > 75 || pctAbove20dma > 12;
  const isPullback = isUptrend && pctAbove20dma >= -2 && pctAbove20dma <= 4 && rsi14 >= 40 && rsi14 <= 60;
  const isBreakout = currentPrice > last20High * 1.005 && volMult > 1.5;
  const isTightening = bbWidth6mPct < 15 && !isBreakout;
  const isDistribution = vsaTag === "DIST" && rsi14 > 65;

  let setupType: SetupType;
  if (isDistribution) setupType = "DISTRIBUTION";
  else if (isBreakout) setupType = "BREAKOUT";
  else if (isExtended) setupType = "EXTENDED";
  else if (isPullback) setupType = "PULLBACK";
  else if (isTightening) setupType = "TIGHTENING";
  else if (isUptrend) setupType = "UPTREND";
  else setupType = "UPTREND";

  // ===== Composite Signal Score (0-100) =====
  const trendScore = isUptrend
    ? clamp(60 + (pctAbove200dma > 0 ? 20 : 0) + (pctAbove20dma > 0 && pctAbove20dma < 8 ? 20 : 10), 0, 100)
    : clamp(30 + (currentPrice > dma50 ? 20 : 0), 0, 100);

  const momScore = clamp(
    0.5 * (rsi14 < 80 ? rsi14 : 80 - (rsi14 - 80) * 1.5) +
    0.5 * clamp(ret1mPct * 1.5 + 40, 0, 100),
    0, 100
  );

  const volScore = clamp(volMult * 30 + 20, 0, 100);

  const timingScore = pctAbove20dma >= -2 && pctAbove20dma <= 5
    ? 90 + (5 - Math.abs(pctAbove20dma - 1.5)) * 2
    : pctAbove20dma > 5 && pctAbove20dma <= 12
      ? 70 - (pctAbove20dma - 5) * 4
      : pctAbove20dma > 12
        ? 30
        : 60;

  const setupQuality: Record<SetupType, number> = {
    BREAKOUT: 95,
    PULLBACK: 88,
    UPTREND: 70,
    TIGHTENING: 55,
    EXTENDED: 35,
    DISTRIBUTION: 20,
  };

  const signalScore = clamp(
    Math.round(
      0.35 * trendScore +
      0.25 * momScore +
      0.15 * volScore +
      0.15 * (pctAbove200dma > 0 ? Math.min(pctAbove200dma * 2 + 30, 100) : 20) +
      0.10 * timingScore +
      0.10 * setupQuality[setupType]
    ),
    0, 100
  );

  // ===== Trade Plan with per-setup R:R =====
  const entryPrice = currentPrice;
  const addPrice = dma20;

  let stopPrice: number;
  switch (setupType) {
    case "BREAKOUT":
      stopPrice = Math.min(last20Low, last20High * 0.97);
      break;
    case "PULLBACK":
      stopPrice = dma20 * 0.985;
      break;
    case "EXTENDED":
      stopPrice = dma20 * 1.02;
      break;
    case "DISTRIBUTION":
      stopPrice = Math.min(last20Low, currentPrice * 0.96);
      break;
    case "TIGHTENING":
      stopPrice = last20Low * 0.98;
      break;
    case "UPTREND":
    default:
      stopPrice = dma50 * 0.98;
      break;
  }

  // Per-setup R:R multipliers
  const RR_PRESETS: Record<SetupType, { t1: number; t2: number }> = {
    BREAKOUT:     { t1: 1.5, t2: 3.0 },
    PULLBACK:     { t1: 1.5, t2: 2.5 },
    EXTENDED:     { t1: 1.0, t2: 2.0 },
    DISTRIBUTION: { t1: 0.7, t2: 1.5 },
    TIGHTENING:   { t1: 1.5, t2: 2.5 },
    UPTREND:      { t1: 1.5, t2: 2.8 },
  };
  const rrPreset = RR_PRESETS[setupType];

  const riskPerShare = entryPrice - stopPrice;
  const target1 = entryPrice + riskPerShare * rrPreset.t1;
  const target2 = entryPrice + riskPerShare * rrPreset.t2;
  const riskReward = riskPerShare > 0 ? clamp((target2 - entryPrice) / riskPerShare, 0, 10) : 0;

  let setupGrade: SetupGrade;
  if (signalScore >= 85 && riskReward >= 2.5) setupGrade = "A+";
  else if (signalScore >= 75 && riskReward >= 2) setupGrade = "A";
  else if (signalScore >= 60) setupGrade = "B";
  else setupGrade = "C";

  const lastTs = candles[candles.length - 1].timestamp;
  const lastDate = new Date(lastTs * 1000).toISOString().slice(0, 10);

  return {
    symbol,
    lastDate,
    currentPrice,
    dma50,
    dma200,
    dma20,
    rsi14,
    avgVolume30d,
    ret1mPct,
    ret1wPct,
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
    signalScore,
    setupType,
    setupGrade,
    entryPrice,
    addPrice,
    stopPrice,
    target1,
    target2,
    riskReward,
    volMult,
    pctAbove20dma,
    vsaTag,
    bollingerWidth,
    bbWidth6mPct,
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
