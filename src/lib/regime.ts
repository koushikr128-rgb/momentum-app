// Market Regime Detector — classifies the broad market into one of 4 regimes
// based on NIFTY 50 trend, breadth proxy, and volatility.

import { Candle } from "./yahoo";

export type MarketRegime = "RISK-ON" | "RISK-OFF" | "CHOP" | "TRANSITION";

export interface RegimeState {
  regime: MarketRegime;
  sizeMultiplier: number;
  niftyClose: number;
  niftyChangePct: number;
  niftyAbove50dma: boolean;
  niftyAbove200dma: boolean;
  nifty50dma: number;
  nifty200dma: number;
  breadthPct: number;
  breadthAdvancing: number;
  breadthTotal: number;
  volatilityPct: number;
  description: string;
  recommendation: string;
  flippedSessionsAgo: number;
  previousRegime: MarketRegime | null;
  asOf: string;
}

function sma(values: number[], n: number): number {
  if (values.length < n) return NaN;
  return values.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function pctStd(values: number[], sample = true): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const ss = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return Math.sqrt(ss / (sample ? n - 1 : n));
}

const REGIME_INFO: Record<MarketRegime, { mult: number; desc: string; rec: string }> = {
  "RISK-ON": {
    mult: 1.0,
    desc: "NIFTY above 50DMA & 200DMA with strong breadth — full capital deployment",
    rec: "Full position sizes. Favour breakouts and pullback entries.",
  },
  "RISK-OFF": {
    mult: 0.25,
    desc: "NIFTY below 50DMA with elevated volatility — defensive posture",
    rec: "Cut sizes to 25%. Tighten stops. No new breakouts. Cash heavy.",
  },
  "CHOP": {
    mult: 0.5,
    desc: "NIFTY range-bound with mixed signals — selective deployment",
    rec: "50% capital. Only A-grade setups. Avoid extended names.",
  },
  "TRANSITION": {
    mult: 0.4,
    desc: "Market regime recently flipped — wait for confirmation",
    rec: "Defensive 40% sizing. Hold existing winners; pause new entries.",
  },
};

export function classifyRegime(
  niftyCandles: Candle[],
  breadthAdvancing: number,
  breadthTotal: number,
  previousRegime: MarketRegime | null,
  regimeHistory: MarketRegime[] = []
): RegimeState | null {
  if (!niftyCandles || niftyCandles.length < 220) return null;

  const closes = niftyCandles.map((c) => c.close);
  const current = closes[closes.length - 1];
  const dma50 = sma(closes, 50);
  const dma200 = sma(closes, 200);
  if (!isFinite(current) || !isFinite(dma50) || !isFinite(dma200)) return null;

  const prevClose = closes[closes.length - 2] || current;
  const niftyChangePct = prevClose > 0 ? (current / prevClose - 1) * 100 : 0;

  const last30 = closes.slice(-31);
  const dailyRets: number[] = [];
  for (let i = 1; i < last30.length; i++) {
    if (last30[i - 1] > 0) dailyRets.push(last30[i] / last30[i - 1] - 1);
  }
  const volDaily = pctStd(dailyRets);
  const volatilityPct = volDaily * Math.sqrt(252) * 100;

  const niftyAbove50dma = current > dma50;
  const niftyAbove200dma = current > dma200;
  const breadthPct = breadthTotal > 0 ? (breadthAdvancing / breadthTotal) * 100 : 50;

  const last252 = closes.slice(-252);
  const rollingVols: number[] = [];
  for (let i = 30; i <= last252.length; i++) {
    const win = last252.slice(i - 30, i);
    const dr: number[] = [];
    for (let j = 1; j < win.length; j++) {
      if (win[j - 1] > 0) dr.push(win[j] / win[j - 1] - 1);
    }
    rollingVols.push(pctStd(dr) * Math.sqrt(252) * 100);
  }
  const volMean = rollingVols.length > 0
    ? rollingVols.reduce((a, b) => a + b, 0) / rollingVols.length
    : volatilityPct;
  const volStd = pctStd(rollingVols);
  const volZ = volStd > 0 ? (volatilityPct - volMean) / volStd : 0;
  const isVolElevated = volZ > 1.0;

  let rawRegime: MarketRegime;
  if (niftyAbove50dma && niftyAbove200dma && dma50 > dma200 && breadthPct > 55) {
    rawRegime = "RISK-ON";
  } else if (!niftyAbove50dma && (isVolElevated || breadthPct < 35)) {
    rawRegime = "RISK-OFF";
  } else if (
    (niftyAbove50dma && !niftyAbove200dma) ||
    (!niftyAbove50dma && niftyAbove200dma) ||
    (niftyAbove50dma && niftyAbove200dma && breadthPct <= 55) ||
    (!niftyAbove50dma && !isVolElevated)
  ) {
    rawRegime = "CHOP";
  } else {
    rawRegime = "RISK-OFF";
  }

  const flippedSessionsAgo = (() => {
    if (!previousRegime) return 0;
    if (previousRegime === rawRegime) return 0;
    if (regimeHistory.length < 2) return 1;
    let count = 0;
    for (let i = regimeHistory.length - 1; i >= 0; i--) {
      if (regimeHistory[i] === rawRegime) count++;
      else break;
    }
    return Math.max(1, count);
  })();

  const isTransition = flippedSessionsAgo > 0 && flippedSessionsAgo <= 5;
  const regime: MarketRegime = isTransition ? "TRANSITION" : rawRegime;
  const info = REGIME_INFO[regime];

  return {
    regime,
    sizeMultiplier: info.mult,
    niftyClose: current,
    niftyChangePct,
    niftyAbove50dma,
    niftyAbove200dma,
    nifty50dma: dma50,
    nifty200dma: dma200,
    breadthPct,
    breadthAdvancing: breadthAdvancing,
    breadthTotal,
    volatilityPct,
    description: info.desc,
    recommendation: info.rec,
    flippedSessionsAgo,
    previousRegime,
    asOf: new Date().toISOString(),
  };
}
