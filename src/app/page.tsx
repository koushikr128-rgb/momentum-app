'use client';

import { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  Activity, ArrowDown, ArrowUp, RefreshCw, AlertTriangle,
  ShieldAlert, TrendingUp, TrendingDown, Gauge, Wallet, Target, Zap,
} from "lucide-react";

import { ScreenedStock, AllocationStock, StopLossStock, StressScenario } from "@/lib/indicators";

type ScreenResponse = {
  universeSize: number;
  passedData: number;
  passedTech: number;
  passedMc: number;
  top10: ScreenedStock[];
  runAt: string;
  elapsedMs: number;
};

type AllocateResponse = {
  allocation: AllocationStock[];
  totalInvested: number;
  totalAllocated: number;
  cashLeftover: number;
  sectorBreakdown: Array<{ sector: string; weight: number; count: number; rupees: number }>;
};

type StopsResponse = {
  stops: StopLossStock[];
  totalPnl: number;
  totalInvested: number;
  pnlPct: number;
  runAt: string;
  statusCounts: { HOLD: number; WATCH: number; EXIT: number };
};

type StressResponse = {
  scenarios: StressScenario[];
  totalInvested: number;
  worstDrawdown: number;
  worstLoss: number;
};

const fmt = (n: number, d = 2) =>
  isNaN(n) || n === null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtINR = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtPct = (n: number) => (isNaN(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);

export default function Home() {
  const [tab, setTab] = useState("screen");
  const [running, setRunning] = useState<"screen" | "stops" | null>(null);

  const [screen, setScreen] = useState<ScreenResponse | null>(null);
  const [alloc, setAlloc] = useState<AllocateResponse | null>(null);
  const [stops, setStops] = useState<StopsResponse | null>(null);
  const [stress, setStress] = useState<StressResponse | null>(null);
  const [totalInvestment, setTotalInvestment] = useState(200000);
  const [allocDirty, setAllocDirty] = useState(false);

  const runScreen = useCallback(async () => {
    setRunning("screen");
    try {
      const res = await fetch("/api/screen", { cache: "no-store" });
      if (!res.ok) throw new Error(`Screen failed (${res.status})`);
      const data: ScreenResponse = await res.json();
      setScreen(data);
      setAllocDirty(true);
      toast({ title: "Screen complete", description: `${data.top10.length} stocks in Top 10 — ${(data.elapsedMs / 1000).toFixed(1)}s` });
    } catch (e) {
      toast({ title: "Screen failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally {
      setRunning(null);
    }
  }, []);

  const runAllocation = useCallback(async () => {
    if (!screen) return;
    try {
      const res = await fetch("/api/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks: screen.top10, totalInvestment }),
      });
      if (!res.ok) throw new Error("Allocation failed");
      const data: AllocateResponse = await res.json();
      setAlloc(data);
      setAllocDirty(false);
      toast({ title: "Allocation computed", description: fmtINR(data.totalInvested) + " across " + data.allocation.length + " stocks" });
    } catch (e) {
      toast({ title: "Allocation failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    }
  }, [screen, totalInvestment]);

  const runStops = useCallback(async () => {
    if (!alloc) return;
    setRunning("stops");
    try {
      const res = await fetch("/api/stops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocation: alloc.allocation }),
      });
      if (!res.ok) throw new Error("Stop-loss fetch failed");
      const data: StopsResponse = await res.json();
      setStops(data);
      toast({ title: "Stop-loss refreshed", description: `P&L ${fmtPct(data.pnlPct)} • ${data.statusCounts.HOLD} HOLD, ${data.statusCounts.WATCH} WATCH, ${data.statusCounts.EXIT} EXIT` });
    } catch (e) {
      toast({ title: "Stop-loss failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally {
      setRunning(null);
    }
  }, [alloc]);

  const runStress = useCallback(async () => {
    if (!alloc) return;
    try {
      const res = await fetch("/api/stress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocation: alloc.allocation, totalInvested: alloc.totalInvested }),
      });
      if (!res.ok) throw new Error("Stress test failed");
      const data: StressResponse = await res.json();
      setStress(data);
      toast({ title: "Stress test complete", description: `Worst drawdown ${data.worstDrawdown.toFixed(2)}%` });
    } catch (e) {
      toast({ title: "Stress test failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    }
  }, [alloc]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Nifty Momentum Tracker</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                High Relative Strength &amp; Strong Trend — Live Dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              <Activity className="w-3 h-3 mr-1" /> {screen ? `Last refresh: ${new Date(screen.runAt).toLocaleTimeString("en-IN")}` : "Not run yet"}
            </Badge>
            <Button onClick={runScreen} disabled={running === "screen"} size="sm">
              <RefreshCw className={`w-4 h-4 mr-2 ${running === "screen" ? "animate-spin" : ""}`} />
              {running === "screen" ? "Running…" : "Run Screen"}
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 mb-6">
            <TabsTrigger value="screen" className="gap-2"><Target className="w-4 h-4" /> Screen</TabsTrigger>
            <TabsTrigger value="alloc" className="gap-2"><Wallet className="w-4 h-4" /> Allocation</TabsTrigger>
            <TabsTrigger value="stops" className="gap-2"><ShieldAlert className="w-4 h-4" /> Stop-Loss</TabsTrigger>
            <TabsTrigger value="stress" className="gap-2"><Zap className="w-4 h-4" /> Stress Test</TabsTrigger>
          </TabsList>

          {/* ============================== Screen tab ============================== */}
          <TabsContent value="screen">
            <ScreenPanel screen={screen} running={running === "screen"} />
          </TabsContent>

          {/* ============================== Allocation tab ============================== */}
          <TabsContent value="alloc">
            <AllocationPanel
              screen={screen}
              alloc={alloc}
              totalInvestment={totalInvestment}
              setTotalInvestment={setTotalInvestment}
              runAllocation={runAllocation}
              allocDirty={allocDirty}
              onGoToStops={() => setTab("stops")}
              onGoToStress={() => setTab("stress")}
            />
          </TabsContent>

          {/* ============================== Stop-Loss tab ============================== */}
          <TabsContent value="stops">
            <StopLossPanel stops={stops} running={running === "stops"} onRefresh={runStops} hasAlloc={!!alloc} onGoToAlloc={() => setTab("alloc")} />
          </TabsContent>

          {/* ============================== Stress tab ============================== */}
          <TabsContent value="stress">
            <StressPanel stress={stress} onRun={runStress} hasAlloc={!!alloc} onGoToAlloc={() => setTab("alloc")} />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 mt-auto py-4 text-center text-xs text-slate-500">
        Live data from Yahoo Finance · RSI(14) Wilder · Universe: Nifty Total Market · Built with Next.js 16
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------- ScreenPanel */
function ScreenPanel({ screen, running }: { screen: ScreenResponse | null; running: boolean }) {
  if (running && !screen) return <Skeleton className="h-96 w-full" />;
  if (!screen) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-600" /> Momentum Screen — Not yet run</CardTitle>
          <CardDescription>
            Click <b>Run Screen</b> at the top to fetch live data for ~{350} NSE stocks and apply the 6 momentum rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-500">
            <p className="mb-2 font-medium text-slate-700 dark:text-slate-300">Screening rules:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Current Price &gt; 200 DMA</li>
              <li>Current Price &gt; 50 DMA</li>
              <li>50 DMA &gt; 200 DMA</li>
              <li>RSI(14) &gt; 55</li>
              <li>Market Cap &gt; ₹500 Cr</li>
              <li>30-day Avg Volume &gt; 50,000</li>
              <li><b>Sort</b>: 6-Month Price Return % DESC, top 10</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Activity className="w-4 h-4" />} label="Universe" value={String(screen.universeSize)} sub="NSE stocks" />
        <StatCard icon={<TrendingUp className="w-4 h-4" />} label="With full data" value={String(screen.passedData)} sub="18-month OHLCV" />
        <StatCard icon={<Gauge className="w-4 h-4" />} label="Pass technical" value={String(screen.passedTech)} sub="MA + RSI + Vol" />
        <StatCard icon={<Wallet className="w-4 h-4" />} label="Pass market cap" value={String(screen.passedMc)} sub="> ₹500 Cr" tone="emerald" />
      </div>

      {/* Top 10 table */}
      <Card>
        <CardHeader>
          <CardTitle>Top 10 Momentum Stocks</CardTitle>
          <CardDescription>
            Ranked by 6-month price return % · Screen took {(screen.elapsedMs / 1000).toFixed(1)}s · as of {new Date(screen.runAt).toLocaleString("en-IN")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="hidden md:table-cell">Sector</TableHead>
                  <TableHead className="text-right">Price (₹)</TableHead>
                  <TableHead className="text-right">RSI</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">MCap (₹Cr)</TableHead>
                  <TableHead className="text-right">1M %</TableHead>
                  <TableHead className="text-right">3M %</TableHead>
                  <TableHead className="text-right">6M %</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">Sharpe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {screen.top10.map((s) => (
                  <TableRow key={s.symbol}>
                    <TableCell className="font-bold text-slate-400">{s.rank}</TableCell>
                    <TableCell>
                      <div className="font-semibold">{s.symbol}</div>
                      <div className="text-xs text-slate-500 line-clamp-1 max-w-[160px]">{s.longName}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-slate-600">{s.sector}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(s.currentPrice)}</TableCell>
                    <TableCell className="text-right">
                      <RsiBadge rsi={s.rsi14} />
                    </TableCell>
                    <TableCell className="text-right hidden sm:table-cell tabular-nums">{fmt(s.marketCapCr, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums"><ReturnCell pct={s.ret1mPct} /></TableCell>
                    <TableCell className="text-right tabular-nums"><ReturnCell pct={s.ret3mPct} /></TableCell>
                    <TableCell className="text-right tabular-nums font-semibold"><ReturnCell pct={s.ret6mPct} /></TableCell>
                    <TableCell className="text-right hidden lg:table-cell tabular-nums">{fmt(s.sharpe)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- AllocationPanel */
function AllocationPanel({
  screen, alloc, totalInvestment, setTotalInvestment, runAllocation, allocDirty, onGoToStops, onGoToStress,
}: {
  screen: ScreenResponse | null;
  alloc: AllocateResponse | null;
  totalInvestment: number;
  setTotalInvestment: (n: number) => void;
  runAllocation: () => void;
  allocDirty: boolean;
  onGoToStops: () => void;
  onGoToStress: () => void;
}) {
  if (!screen) {
    return (
      <Card><CardHeader>
        <CardTitle>Portfolio Allocation</CardTitle>
        <CardDescription>Run the screen first to enable allocation.</CardDescription>
      </CardHeader></Card>
    );
  }
  return (
    <div className="space-y-4">
      {/* Investment input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="w-5 h-5 text-emerald-600" /> Investment Amount</CardTitle>
          <CardDescription>Enter your total capital to allocate across the Top 10 momentum stocks.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="amount">Total Investment (₹)</Label>
              <Input
                id="amount"
                type="number"
                value={totalInvestment}
                onChange={(e) => { setTotalInvestment(Number(e.target.value)); setAllocDirty(true); }}
                className="mt-1"
                step={10000}
                min={50000}
              />
            </div>
            <Button onClick={runAllocation} disabled={!screen}>
              {allocDirty || !alloc ? "Compute Allocation" : "Recompute"}
            </Button>
            {alloc && (
              <>
                <Button variant="outline" onClick={onGoToStops}><ShieldAlert className="w-4 h-4 mr-2" /> Check Stops</Button>
                <Button variant="outline" onClick={onGoToStress}><Zap className="w-4 h-4 mr-2" /> Stress Test</Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {alloc && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={<Wallet className="w-4 h-4" />} label="Allocated" value={fmtINR(alloc.totalAllocated)} sub={`${fmt(alloc.totalAllocated / alloc.totalInvested * 100, 1)}% of capital`} />
            <StatCard icon={<Activity className="w-4 h-4" />} label="Cash leftover" value={fmtINR(alloc.cashLeftover)} sub="from share rounding" />
            <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Weighted 6M ret" value={fmtPct(alloc.allocation.reduce((a, s) => a + s.weight * s.ret6mPct, 0) / alloc.allocation.reduce((a, s) => a + s.weight, 0))} sub="portfolio momentum" tone="emerald" />
            <StatCard icon={<Gauge className="w-4 h-4" />} label="Weighted vol" value={`${fmt(alloc.allocation.reduce((a, s) => a + s.weight * s.annVolPct, 0))}%`} sub="annualized" tone="amber" />
          </div>

          {/* Allocation table */}
          <Card>
            <CardHeader>
              <CardTitle>Allocation Breakdown — {fmtINR(alloc.totalInvested)}</CardTitle>
              <CardDescription>Inverse-volatility base × RSI penalty · Max 15% per stock · Max 25% per sector</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead className="hidden md:table-cell">Sector</TableHead>
                      <TableHead className="text-right">Price (₹)</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead className="text-right">₹ Amount</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">6M %</TableHead>
                      <TableHead className="text-right">RSI</TableHead>
                      <TableHead className="hidden lg:table-cell">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alloc.allocation.map((s, i) => (
                      <TableRow key={s.symbol}>
                        <TableCell className="font-bold text-slate-400">{i + 1}</TableCell>
                        <TableCell className="font-semibold">{s.symbol}</TableCell>
                        <TableCell className="hidden md:table-cell text-slate-600">{s.sector}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(s.currentPrice)}</TableCell>
                        <TableCell className="text-right font-semibold">
                          <div className="flex items-center gap-2 justify-end">
                            <Progress value={s.weight * 100} className="w-12 h-2" />
                            {fmt(s.weight * 100, 2)}%
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtINR(s.rupees)}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.shares}</TableCell>
                        <TableCell className="text-right tabular-nums"><ReturnCell pct={s.ret6mPct} /></TableCell>
                        <TableCell className="text-right"><RsiBadge rsi={s.rsi14} /></TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-slate-500">{s.notes || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Sector breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Sector Diversification</CardTitle>
              <CardDescription>Max 25% per sector — ensures no single industry dominates the book</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alloc.sectorBreakdown.map((s) => (
                  <div key={s.sector} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{s.sector} <span className="text-slate-500">({s.count} stock{s.count > 1 ? "s" : ""})</span></span>
                      <span className="tabular-nums">{fmt(s.weight * 100, 2)}% · {fmtINR(s.rupees)}</span>
                    </div>
                    <Progress value={s.weight * 100} className="h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- StopLossPanel */
function StopLossPanel({ stops, running, onRefresh, hasAlloc, onGoToAlloc }: {
  stops: StopsResponse | null;
  running: boolean;
  onRefresh: () => void;
  hasAlloc: boolean;
  onGoToAlloc: () => void;
}) {
  if (!hasAlloc) {
    return (
      <Card><CardHeader>
        <CardTitle>Stop-Loss Monitor</CardTitle>
        <CardDescription>You need an allocation first. <Button variant="link" className="p-0 h-auto" onClick={onGoToAlloc}>Go to Allocation →</Button></CardDescription>
      </CardHeader></Card>
    );
  }
  return (
    <div className="space-y-4">
      {/* Summary */}
      {stops && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard icon={<Activity className="w-4 h-4" />} label="Total P&L" value={fmtINR(stops.totalPnl)} sub={fmtPct(stops.pnlPct)} tone={stops.totalPnl >= 0 ? "emerald" : "red"} />
          <StatCard icon={<ShieldAlert className="w-4 h-4" />} label="HOLD" value={String(stops.statusCounts.HOLD)} sub="healthy" tone="emerald" />
          <StatCard icon={<AlertTriangle className="w-4 h-4" />} label="WATCH" value={String(stops.statusCounts.WATCH)} sub="near stop" tone="amber" />
          <StatCard icon={<TrendingDown className="w-4 h-4" />} label="EXIT" value={String(stops.statusCounts.EXIT)} sub="stop hit" tone="red" />
          <StatCard icon={<Activity className="w-4 h-4" />} label="As of" value={new Date(stops.runAt).toLocaleTimeString("en-IN")} sub="latest NSE close" />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-emerald-600" /> Stop-Loss Status</CardTitle>
            <CardDescription>
              Rules: Trend (close &lt; 50 DMA) · Hard stop (entry − 8%) · Trailing (peak × 0.85) · Watch zone (within 2%)
            </CardDescription>
          </div>
          <Button onClick={onRefresh} disabled={running} size="sm" variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${running ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {running && !stops ? <Skeleton className="h-48 w-full" /> : stops ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">50 DMA</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Peak</TableHead>
                    <TableHead className="text-right">Stop</TableHead>
                    <TableHead className="text-right">P&L %</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">P&L ₹</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stops.stops.map((s) => (
                    <TableRow key={s.symbol}>
                      <TableCell className="font-semibold">{s.symbol}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(s.entryPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmt(s.currentPrice)}</TableCell>
                      <TableCell className="text-right hidden sm:table-cell tabular-nums">{fmt(s.dma50)}</TableCell>
                      <TableCell className="text-right hidden md:table-cell tabular-nums">{fmt(s.peakSinceEntry)}</TableCell>
                      <TableCell className="text-right tabular-nums text-red-600">{fmt(s.activeStop)}</TableCell>
                      <TableCell className="text-right tabular-nums"><ReturnCell pct={s.pnlPct} /></TableCell>
                      <TableCell className="text-right hidden sm:table-cell tabular-nums"><ReturnCell pct={s.pnlRupees} rupeeMode /></TableCell>
                      <TableCell className="text-center"><StatusBadge status={s.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {stops.stops.some((s) => s.reasons) && (
                <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs">
                  <div className="font-medium text-amber-800 mb-1">⚠ Watch / Exit reasons:</div>
                  <ul className="space-y-1 text-amber-700">
                    {stops.stops.filter((s) => s.reasons).map((s) => (
                      <li key={s.symbol}><b>{s.symbol}</b>: {s.reasons}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500 p-6 text-center">
              Click <b>Refresh</b> to fetch live prices and apply stop rules.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- StressPanel */
function StressPanel({ stress, onRun, hasAlloc, onGoToAlloc }: {
  stress: StressResponse | null;
  onRun: () => void;
  hasAlloc: boolean;
  onGoToAlloc: () => void;
}) {
  if (!hasAlloc) {
    return (
      <Card><CardHeader>
        <CardTitle>Stress Test</CardTitle>
        <CardDescription>You need an allocation first. <Button variant="link" className="p-0 h-auto" onClick={onGoToAlloc}>Go to Allocation →</Button></CardDescription>
      </CardHeader></Card>
    );
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Zap className="w-5 h-5 text-amber-500" /> Stress Test Scenarios</CardTitle>
            <CardDescription>5 adverse scenarios simulated against your live allocation</CardDescription>
          </div>
          <Button onClick={onRun} size="sm" variant="outline">
            <Zap className="w-4 h-4 mr-2" /> Run Stress Test
          </Button>
        </CardHeader>
        <CardContent>
          {stress ? (
            <>
              {/* Summary cards per scenario */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                {stress.scenarios.map((sc) => (
                  <Card key={sc.name} className={sc.drawdownPct > 15 ? "border-red-300 bg-red-50/50" : sc.drawdownPct > 10 ? "border-amber-300 bg-amber-50/50" : ""}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-semibold text-sm">{sc.name}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{sc.description}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <div className="text-xs text-slate-500">Drawdown</div>
                          <div className={`font-bold tabular-nums ${sc.drawdownPct > 15 ? "text-red-600" : sc.drawdownPct > 10 ? "text-amber-600" : "text-slate-700"}`}>
                            {sc.drawdownPct.toFixed(2)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">₹ Loss</div>
                          <div className="font-bold tabular-nums text-red-600">{fmtINR(sc.totalLoss)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500"># Stocks hit</div>
                          <div className="font-semibold tabular-nums">{sc.stocksHit}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Worst stock</div>
                          <div className="font-semibold text-xs">{sc.worstStockSymbol}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Resilience summary */}
              <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wide">Worst-case drawdown</div>
                      <div className="text-2xl font-bold text-red-600">{stress.worstDrawdown.toFixed(2)}%</div>
                      <div className="text-xs text-slate-500">{fmtINR(Math.abs(stress.worstLoss))} loss</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wide">Recommended cash buffer</div>
                      <div className="text-2xl font-bold text-amber-600">{fmtINR(Math.abs(stress.worstLoss))}</div>
                      <div className="text-xs text-slate-500">to survive worst case</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="text-sm text-slate-500 p-6 text-center">
              Click <b>Run Stress Test</b> to simulate 5 adverse scenarios against your current allocation.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-scenario detail tables */}
      {stress && (
        <Card>
          <CardHeader>
            <CardTitle>Per-Stock Impact by Scenario</CardTitle>
            <CardDescription>How each holding responds in each scenario</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {stress.scenarios.map((sc) => (
                <div key={sc.name}>
                  <div className="text-sm font-semibold mb-2 flex items-center justify-between">
                    <span>{sc.name}</span>
                    <Badge variant={sc.drawdownPct > 15 ? "destructive" : sc.drawdownPct > 10 ? "secondary" : "outline"}>
                      {sc.drawdownPct.toFixed(2)}% drawdown
                    </Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Symbol</TableHead>
                          <TableHead className="text-right">₹ Allocated</TableHead>
                          <TableHead className="text-right">Shock %</TableHead>
                          <TableHead className="text-right">₹ Loss</TableHead>
                          <TableHead className="text-right">New Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sc.detail.map((d) => (
                          <TableRow key={d.symbol}>
                            <TableCell className="font-medium">{d.symbol}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtINR(d.rupees)}</TableCell>
                            <TableCell className="text-right tabular-nums text-red-600">{(d.shockPct * 100).toFixed(0)}%</TableCell>
                            <TableCell className="text-right tabular-nums text-red-600">{fmtINR(d.rupeeLoss)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtINR(d.newValue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */
function StatCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "emerald" | "amber" | "red" }) {
  const toneClass = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : tone === "red" ? "text-red-600" : "text-slate-900 dark:text-white";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
          <span className="text-slate-400">{icon}</span>
        </div>
        <div className={`text-lg font-bold tabular-nums ${toneClass}`}>{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ReturnCell({ pct, rupeeMode }: { pct: number; rupeeMode?: boolean }) {
  if (isNaN(pct)) return <span className="text-slate-400">—</span>;
  const positive = pct >= 0;
  const cls = positive ? "text-emerald-600" : "text-red-600";
  const Icon = positive ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${cls}`}>
      <Icon className="w-3 h-3" />
      {rupeeMode ? `${pct >= 0 ? "+" : "−"}₹${Math.abs(Math.round(pct)).toLocaleString("en-IN")}` : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}
    </span>
  );
}

function RsiBadge({ rsi }: { rsi: number }) {
  const tone = rsi > 80 ? "bg-red-100 text-red-700 border-red-200" : rsi > 70 ? "bg-amber-100 text-amber-700 border-amber-200" : rsi > 55 ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${tone}`}>{rsi.toFixed(1)}</span>;
}

function StatusBadge({ status }: { status: "HOLD" | "WATCH" | "EXIT" }) {
  const map = {
    HOLD: "bg-emerald-100 text-emerald-700 border-emerald-200",
    WATCH: "bg-amber-100 text-amber-700 border-amber-200",
    EXIT: "bg-red-100 text-red-700 border-red-200",
  };
  return <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-bold border ${map[status]}`}>{status}</span>;
}
