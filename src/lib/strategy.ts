// Strategy engine — applies the 6 momentum rules + allocation + stops + stress
import {
  StockMetrics,
  ScreenedStock,
  AllocationStock,
  StopLossStock,
  StressScenario,
} from "./indicators";

export const STRATEGY_RULES = [
  { metric: "Current Price", op: ">", value: "200 DMA", rationale: "Confirms long-term uptrend" },
  { metric: "Current Price", op: ">", value: "50 DMA", rationale: "Confirms short-term strength" },
  { metric: "50 DMA", op: ">", value: "200 DMA", rationale: "Golden-cross alignment" },
  { metric: "RSI(14)", op: ">", value: "55", rationale: "Strong but not overbought" },
  { metric: "Market Cap", op: ">", value: "₹500 Cr", rationale: "Exclude micro-caps for liquidity" },
  { metric: "30D Avg Volume", op: ">", value: "50,000", rationale: "Tradeable liquidity" },
  { metric: "Sort", op: "ORDER BY", value: "6M Return % DESC", rationale: "Rank by relative strength" },
  { metric: "Universe", op: "≈", value: "Nifty Total Market", rationale: "Coverage breadth" },
  { metric: "Top N", op: "LIMIT", value: "10", rationale: "Concentrated shortlist" },
];

export interface ScreenResult {
  universeSize: number;
  passedData: number;
  passedTech: number;
  passedMc: number;
  top10: ScreenedStock[];
  runAt: string;
}

export function applyTechnicalFilter(m: StockMetrics): boolean {
  return (
    m.currentPrice > m.dma200 &&
    m.currentPrice > m.dma50 &&
    m.dma50 > m.dma200 &&
    m.rsi14 > 55 &&
    m.avgVolume30d > 50_000 &&
    !isNaN(m.ret6mPct)
  );
}

export function applyMarketCapFilter(m: StockMetrics, marketCapCr: number): boolean {
  return marketCapCr > 500;
}

/**
 * Allocation engine — inverse vol × RSI penalty, with position & sector caps.
 */
export interface RemovedStock {
  symbol: string;
  sector: string;
  currentPrice: number;
  attemptedRupees: number;  // rupees that were tentatively allocated before removal
  attemptedWeight: number;
  reason: string;
}

export interface AllocationResult {
  allocation: AllocationStock[];
  removedStocks: RemovedStock[];
}

/**
 * Allocation engine — inverse-vol × RSI penalty, with position & sector caps,
 * floor, AND a real-world affordability filter:
 *   If a stock's allocated rupees < its current price (can't buy even 1 share),
 *   remove it from the book and redistribute its weight to the remaining stocks.
 *   Repeat iteratively until all remaining stocks are affordable.
 *
 * Example: Top 30 + ₹4L → Page Industries at ₹37,000 gets 4% = ₹16,667.
 * ₹16,667 < ₹37,000, so Page Industries is removed and its 4% is redistributed.
 */
export function computeAllocation(
  stocks: ScreenedStock[],
  totalInvestment: number,
  posCap = 0.15,
  sectorCap = 0.25,
  floor = 0.05
): AllocationResult {
  if (stocks.length === 0) return { allocation: [], removedStocks: [] };

  const removedStocks: RemovedStock[] = [];
  let workingSet = stocks.slice();

  // Iterate: compute weights, remove unaffordable stocks, redistribute.
  // Limit to stocks.length iterations to prevent infinite loop.
  for (let pass = 0; pass < stocks.length; pass++) {
    if (workingSet.length === 0) break;

    const d = workingSet.map((s) => ({
      ...s,
      baseW: 1 / (s.annVolPct || 30),
      rsiMult: rsiMultiplier(s.rsi14),
    }));
    const adjSum = d.reduce((acc, s) => acc + s.baseW * s.rsiMult, 0);
    let w = d.map((s) => (s.baseW * s.rsiMult) / adjSum);

    // Iterative cap-and-renormalize (floor, posCap, sectorCap)
    for (let iter = 0; iter < 20; iter++) {
      w = w.map((v) => Math.max(v, floor));
      w = w.map((v) => Math.min(v, posCap));
      const sectorSums = new Map<string, number>();
      d.forEach((s, i) => {
        sectorSums.set(s.sector, (sectorSums.get(s.sector) || 0) + w[i]);
      });
      d.forEach((s, i) => {
        const ss = sectorSums.get(s.sector)!;
        if (ss > sectorCap) {
          w[i] = (w[i] * sectorCap) / ss;
        }
      });
      const sum = w.reduce((a, b) => a + b, 0);
      w = w.map((v) => v / sum);
    }

    // Affordability check: remove stocks where rupees < currentPrice (can't buy 1 share)
    const toRemove: number[] = [];
    d.forEach((s, i) => {
      const rupees = w[i] * totalInvestment;
      // Use a small buffer (1.05x) so rounding to whole shares doesn't leave 0 shares
      if (rupees < s.currentPrice * 1.05) {
        toRemove.push(i);
      }
    });

    if (toRemove.length === 0) {
      // All stocks affordable — build final allocation
      const allocation = d
        .map((s, i) => {
          const weight = w[i];
          const rupees = weight * totalInvestment;
          const shares = Math.max(1, Math.round(rupees / s.currentPrice));
          const notes: string[] = [];
          if (s.rsi14 > 80) notes.push("RSI>80 halved");
          else if (s.rsi14 > 70) notes.push("RSI>70 −25%");
          if (s.annVolPct > 60) notes.push("High vol");
          if (weight >= posCap - 0.005) notes.push(`capped@${(posCap * 100).toFixed(0)}%`);
          return {
            ...s,
            weight,
            rupees,
            shares,
            rsiMultiplier: s.rsiMult,
            notes: notes.join(", "),
          };
        })
        .sort((a, b) => b.weight - a.weight);
      return { allocation, removedStocks };
    }

    // Remove unaffordable stocks, record them, and re-iterate with smaller set
    toRemove
      .sort((a, b) => b - a) // descending so splice doesn't shift indices
      .forEach((i) => {
        const s = d[i];
        const rupees = w[i] * totalInvestment;
        removedStocks.push({
          symbol: s.symbol,
          sector: s.sector,
          currentPrice: s.currentPrice,
          attemptedRupees: rupees,
          attemptedWeight: w[i],
          reason: `Price ₹${s.currentPrice.toFixed(0)} > allocation ₹${rupees.toFixed(0)} (can't buy 1 share)`,
        });
        workingSet = workingSet.filter((x) => x.symbol !== s.symbol);
      });
  }

  // Fallback (shouldn't reach here normally)
  return { allocation: [], removedStocks };
}

function rsiMultiplier(rsi: number): number {
  if (isNaN(rsi)) return 1;
  if (rsi > 80) return 0.5;
  if (rsi > 70) return 0.75;
  return 1;
}

/**
 * Stop-loss monitor — uses entry price (from allocation) + fresh OHLCV (already in metrics).
 */
export function computeStopLoss(
  alloc: AllocationStock[],
  freshMetrics: Map<string, StockMetrics>
): StopLossStock[] {
  const HARD_STOP_PCT = -0.08;
  const TRAILING_PCT = -0.15;
  const WATCH_BAND = 0.02;

  return alloc.map((a) => {
    const fresh = freshMetrics.get(a.symbol);
    const currentPrice = fresh?.currentPrice ?? a.currentPrice;
    const dma50 = fresh?.dma50 ?? a.dma50;
    const peakSinceEntry = fresh ? Math.max(...Array.from({ length: 0 })) : a.high52w;
    // Use peak from fresh metrics if available; else 52w high
    const peak = fresh ? Math.max(fresh.high52w, currentPrice, a.currentPrice) : a.high52w;

    const hardStop = a.currentPrice * (1 + HARD_STOP_PCT);
    const trailingStop = peak * (1 + TRAILING_PCT);
    const trendStop = dma50;
    const activeStop = Math.max(hardStop, trailingStop, trendStop);

    let status: "HOLD" | "WATCH" | "EXIT" = "HOLD";
    const reasons: string[] = [];
    if (currentPrice < dma50) {
      status = "EXIT";
      reasons.push(`Below 50 DMA (₹${dma50.toFixed(2)})`);
    }
    if (currentPrice <= hardStop) {
      status = "EXIT";
      reasons.push(`Hard stop hit (₹${hardStop.toFixed(2)})`);
    }
    if (currentPrice <= trailingStop) {
      status = "EXIT";
      reasons.push(`Trailing stop hit (₹${trailingStop.toFixed(2)})`);
    }
    if (status !== "EXIT") {
      const gapTrend = (currentPrice - trendStop) / currentPrice;
      const gapHard = (currentPrice - hardStop) / currentPrice;
      const gapTrail = (currentPrice - trailingStop) / currentPrice;
      const minGap = Math.min(gapTrend, gapHard, gapTrail);
      if (minGap < WATCH_BAND) {
        status = "WATCH";
        if (gapTrend < WATCH_BAND) reasons.push(`Near 50 DMA (${(gapTrend * 100).toFixed(1)}%)`);
        if (gapHard < WATCH_BAND) reasons.push(`Near hard stop (${(gapHard * 100).toFixed(1)}%)`);
        if (gapTrail < WATCH_BAND) reasons.push(`Near trailing stop (${(gapTrail * 100).toFixed(1)}%)`);
      }
    }

    const pnlPct = (currentPrice / a.currentPrice - 1) * 100;
    const pnlRupees = (currentPrice - a.currentPrice) * a.shares;

    return {
      symbol: a.symbol,
      sector: a.sector,
      entryPrice: a.currentPrice,
      currentPrice,
      dma50,
      peakSinceEntry: peak,
      hardStop,
      trailingStop,
      trendStop,
      activeStop,
      pnlPct,
      pnlRupees,
      shares: a.shares,
      rupees: a.rupees,
      status,
      reasons: reasons.join("; "),
    };
  });
}

/**
 * Stress test scenarios — same 5 scenarios as the Python version.
 */
export function computeStressTest(alloc: AllocationStock[], totalInvested: number): StressScenario[] {
  const scenarios: Array<{
    name: string;
    description: string;
    shockFn: (s: AllocationStock) => number;
  }> = [
    {
      name: "A. RSI Overbought Crash",
      description: "RSI>80 stocks drop 25%, RSI 70-80 drop 15%",
      shockFn: (s) => (s.rsi14 > 80 ? -0.25 : s.rsi14 > 70 ? -0.15 : 0),
    },
    {
      name: "B. Sector Rotation",
      description: `Largest sector drops 20%`,
      shockFn: (s) => {
        const sectorWeights = new Map<string, number>();
        alloc.forEach((x) => sectorWeights.set(x.sector, (sectorWeights.get(x.sector) || 0) + x.weight));
        const biggestSector = [...sectorWeights.entries()].sort((a, b) => b[1] - a[1])[0][0];
        return s.sector === biggestSector ? -0.20 : 0;
      },
    },
    {
      name: "C. Market Correction",
      description: "All stocks drop 10%",
      shockFn: () => -0.10,
    },
    {
      name: "D. Volatility Spike",
      description: "High-vol (>50% ann vol) stocks drop 20%, others drop 8%",
      shockFn: (s) => (s.annVolPct > 50 ? -0.20 : -0.08),
    },
    {
      name: "E. Black Swan",
      description: "All stocks drop 25% (worst case)",
      shockFn: () => -0.25,
    },
  ];

  return scenarios.map((sc) => {
    const detail = alloc.map((s) => {
      const shockPct = sc.shockFn(s);
      const rupeeLoss = s.rupees * shockPct;
      return {
        symbol: s.symbol,
        sector: s.sector,
        weight: s.weight,
        rupees: s.rupees,
        shockPct,
        rupeeLoss,
        newValue: s.rupees + rupeeLoss,
      };
    });
    const totalLoss = detail.reduce((a, b) => a + b.rupeeLoss, 0);
    const newValue = totalInvested + totalLoss;
    const worst = detail.reduce((a, b) => (b.rupeeLoss < a.rupeeLoss ? b : a), detail[0]);
    return {
      name: sc.name,
      description: sc.description,
      stocksHit: detail.filter((d) => d.shockPct < 0).length,
      totalLoss,
      newValue,
      drawdownPct: (totalLoss / totalInvested) * 100,
      worstStockSymbol: worst.symbol,
      worstStockLoss: worst.rupeeLoss,
      detail,
    };
  });
}
