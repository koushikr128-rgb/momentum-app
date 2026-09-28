'use client';

import { useState, useCallback, useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import {
  Activity, ArrowDown, ArrowUp, RefreshCw, AlertTriangle,
  ShieldAlert, TrendingUp, TrendingDown, Gauge, Wallet, Target, Zap, Timer, Clock,
  Bell, BellRing, History, GitCompare,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

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

type BacktestSummary = {
  backtest_period: string;
  rebalances: number;
  initial_capital: number;
  final_strategy: number;
  final_benchmark: number;
  total_strategy_ret_pct: number;
  total_benchmark_ret_pct: number;
  cagr_strategy_pct: number;
  cagr_benchmark_pct: number;
  max_drawdown_pct: number;
  sharpe: number;
  win_rate_pct: number;
  winners: number;
  losers: number;
  avg_winner_pct: number;
  avg_loser_pct: number;
  excess_return_pct: number;
};

type BacktestResponse = {
  equity_curve: Array<{ date: string; strategy: number; benchmark: number }>;
  monthly_returns: Array<{ month: string; strategy_ret: number; benchmark_ret: number }>;
  summary: BacktestSummary | null;
  picks_history: Array<{ date: string; picks: string[]; strategy_ret: number; benchmark_ret: number }>;
  run_at: string;
  elapsedMs?: number;
  cached?: boolean;
  error?: string;
};

type CorrelationResponse = {
  matrix: (string | number)[][];
  symbols: string[];
  effectiveBets: number;
  avgCorrelation: number;
  highCorrelationPairs: Array<{ a: string; b: string; rho: number }>;
  nDataPoints: number;
  error?: string;
};

const fmt = (n: number, d = 2) =>
  isNaN(n) || n === null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtINR = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtPct = (n: number) => (isNaN(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);

const AUTO_REFRESH_OPTIONS = [
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 180, label: "3 hours" },
  { value: 360, label: "6 hours" },
];

export default function Home() {
  const [tab, setTab] = useState("screen");
  const [running, setRunning] = useState<"screen" | "stops" | null>(null);

  const [screen, setScreen] = useState<ScreenResponse | null>(null);
  const [alloc, setAlloc] = useState<AllocateResponse | null>(null);
  const [stops, setStops] = useState<StopsResponse | null>(null);
  const [stress, setStress] = useState<StressResponse | null>(null);
  const [totalInvestment, setTotalInvestment] = useState(200000);
  const [allocDirty, setAllocDirty] = useState(false);

  // Auto-refresh state
  const [autoRefreshOn, setAutoRefreshOn] = useState(false);
  const [autoRefreshMin, setAutoRefreshMin] = useState(60);
  const [nextRunAt, setNextRunAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<string>("");
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Backtest state
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [backtestRunning, setBacktestRunning] = useState(false);

  // Correlation state
  const [correlation, setCorrelation] = useState<CorrelationResponse | null>(null);
  const [correlationRunning, setCorrelationRunning] = useState(false);

  // Push notification state
  // Initialize as "loading" — replaced with real value on client mount via useEffect.
  // This avoids SSR hydration mismatch because Notification doesn't exist server-side.
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported" | "loading">("loading");
  const lastAlertedRef = useRef<string>("");  // hash of last alerted symbols to avoid spamming

  useEffect(() => {
    setNotifPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  const runScreen = useCallback(async (silent = false) => {
    if (!silent) setRunning("screen");
    try {
      const res = await fetch("/api/screen", { cache: "no-store" });
      if (!res.ok) throw new Error(`Screen failed (${res.status})`);
      const data: ScreenResponse = await res.json();
      setScreen(data);
      setAllocDirty(true);
      if (!silent) {
        toast({ title: "Screen complete", description: `${data.top10.length} stocks in Top 10 — ${(data.elapsedMs / 1000).toFixed(1)}s` });
      }
      return data;
    } catch (e) {
      toast({ title: "Screen failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
      return null;
    } finally {
      setRunning(null);
    }
  }, []);

  const runAllocation = useCallback(async (silent = false) => {
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
      if (!silent) {
        toast({ title: "Allocation computed", description: fmtINR(data.totalInvested) + " across " + data.allocation.length + " stocks" });
      }
      return data;
    } catch (e) {
      if (!silent) {
        toast({ title: "Allocation failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
      }
      return null;
    }
  }, [screen, totalInvestment]);

  const runStops = useCallback(async (silent = false) => {
    if (!alloc) return;
    if (!silent) setRunning("stops");
    try {
      const res = await fetch("/api/stops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocation: alloc.allocation }),
      });
      if (!res.ok) throw new Error("Stop-loss fetch failed");
      const data: StopsResponse = await res.json();
      setStops(data);
      if (!silent) {
        toast({ title: "Stop-loss refreshed", description: `P&L ${fmtPct(data.pnlPct)} • ${data.statusCounts.HOLD} HOLD, ${data.statusCounts.WATCH} WATCH, ${data.statusCounts.EXIT} EXIT` });
      }
      return data;
    } catch (e) {
      if (!silent) {
        toast({ title: "Stop-loss failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
      }
      return null;
    } finally {
      setRunning(null);
    }
  }, [alloc]);

  const runStress = useCallback(async (silent = false) => {
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
      if (!silent) {
        toast({ title: "Stress test complete", description: `Worst drawdown ${data.worstDrawdown.toFixed(2)}%` });
      }
      return data;
    } catch (e) {
      if (!silent) {
        toast({ title: "Stress test failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
      }
      return null;
    }
  }, [alloc]);

  // ---------- Auto-refresh engine ----------
  // On each tick, run screen silently. If allocation exists, re-run it. If stops exist, re-run them.
  // If stress exists, re-run it too. Then reset the next-run timer.
  const runAutoRefresh = useCallback(async () => {
    const fresh = await runScreen(true);
    if (!fresh) return;
    // re-allocate if user already had an allocation
    const newAlloc = await runAllocation(true);
    if (newAlloc) {
      // re-run stops + stress using the new allocation
      const stopsData = await runStopsWith(newAlloc, true);
      await runStressWith(newAlloc, true);
      // Re-run correlation if user had it open
      if (correlation) {
        await runCorrelationWith(newAlloc);
      }
      // Fire push notifications if any EXIT/WATCH holdings
      if (stopsData) {
        fireNotificationsIfAlert(stopsData);
      }
    }
    setNextRunAt(Date.now() + autoRefreshMin * 60 * 1000);
    toast({
      title: "Auto-refresh complete",
      description: `Next refresh in ${autoRefreshMin} min · ${new Date(Date.now() + autoRefreshMin * 60 * 1000).toLocaleTimeString("en-IN")}`,
    });
  }, [runScreen, runAllocation, autoRefreshMin, correlation]);

  // ---------- Backtest ----------
  const runBacktest = useCallback(async () => {
    setBacktestRunning(true);
    try {
      const res = await fetch("/api/backtest", { cache: "no-store" });
      if (!res.ok) throw new Error(`Backtest failed (${res.status})`);
      const data: BacktestResponse = await res.json();
      setBacktest(data);
      if (data.summary) {
        toast({
          title: "Backtest complete",
          description: `CAGR ${data.summary.cagr_strategy_pct}% vs Nifty ${data.summary.cagr_benchmark_pct}% · Sharpe ${data.summary.sharpe}`,
        });
      } else if (data.error) {
        toast({ title: "Backtest failed", description: data.error, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Backtest failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally {
      setBacktestRunning(false);
    }
  }, []);

  // ---------- Correlation ----------
  const runCorrelationWith = useCallback(async (allocArg: AllocateResponse) => {
    setCorrelationRunning(true);
    try {
      const res = await fetch("/api/correlation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocation: allocArg.allocation }),
      });
      if (!res.ok) throw new Error("Correlation failed");
      const data: CorrelationResponse = await res.json();
      setCorrelation(data);
      return data;
    } catch {
      return null;
    } finally {
      setCorrelationRunning(false);
    }
  }, []);

  const runCorrelation = useCallback(async () => {
    if (!alloc) return;
    const data = await runCorrelationWith(alloc);
    if (data && !data.error) {
      toast({
        title: "Correlation computed",
        description: `${data.symbols.length} stocks · Effective bets: ${data.effectiveBets} · Avg ρ: ${data.avgCorrelation.toFixed(2)}`,
      });
    } else if (data?.error) {
      toast({ title: "Correlation failed", description: data.error, variant: "destructive" });
    }
  }, [alloc, runCorrelationWith]);

  // ---------- Push notifications ----------
  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === "undefined") {
      toast({ title: "Not supported", description: "Your browser doesn't support notifications", variant: "destructive" });
      return;
    }
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === "granted") {
      toast({ title: "Notifications enabled", description: "You'll be pinged when any holding hits EXIT or WATCH status" });
      new Notification("Nifty Momentum Tracker", {
        body: "✅ Notifications enabled. We'll alert you when holdings need attention.",
      });
    } else {
      toast({ title: "Permission denied", description: "Enable notifications in browser settings to receive alerts", variant: "destructive" });
    }
  }, []);

  const fireNotificationsIfAlert = useCallback((stopsData: StopsResponse) => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    const alerts = stopsData.stops.filter((s) => s.status === "EXIT" || s.status === "WATCH");
    if (alerts.length === 0) return;
    // Build hash to dedupe (don't fire same alert twice in a row)
    const hash = alerts.map((a) => `${a.symbol}:${a.status}`).sort().join("|");
    if (hash === lastAlertedRef.current) return;
    lastAlertedRef.current = hash;
    const exitCount = alerts.filter((a) => a.status === "EXIT").length;
    const watchCount = alerts.filter((a) => a.status === "WATCH").length;
    const title = exitCount > 0 ? `🚨 ${exitCount} EXIT signal${exitCount > 1 ? "s" : ""}` : `⚠ ${watchCount} stock${watchCount > 1 ? "s" : ""} on WATCH`;
    const body = alerts
      .slice(0, 5)
      .map((a) => `${a.symbol}: ${a.status} (${a.pnlPct > 0 ? "+" : ""}${a.pnlPct.toFixed(1)}% — ${a.reasons || "healthy"})`)
      .join("\n");
    new Notification(title, { body, tag: "nifty-alert", requireInteraction: exitCount > 0 });
  }, []);

  // Helpers that accept an explicit allocation (used by auto-refresh chain)
  const runStopsWith = useCallback(async (allocArg: AllocateResponse, silent = false) => {
    setRunning("stops");
    try {
      const res = await fetch("/api/stops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocation: allocArg.allocation }),
      });
      if (!res.ok) throw new Error("Stop-loss fetch failed");
      const data: StopsResponse = await res.json();
      setStops(data);
      return data;
    } catch {
      return null;
    } finally {
      setRunning(null);
    }
  }, []);

  const runStressWith = useCallback(async (allocArg: AllocateResponse, silent = false) => {
    try {
      const res = await fetch("/api/stress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocation: allocArg.allocation, totalInvested: allocArg.totalInvested }),
      });
      if (!res.ok) throw new Error("Stress test failed");
      const data: StressResponse = await res.json();
      setStress(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  // When auto-refresh is toggled on, schedule the first run + start countdown ticker
  useEffect(() => {
    if (!autoRefreshOn) {
      setNextRunAt(null);
      setCountdown("");
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
      return;
    }
    // Schedule first auto-run
    setNextRunAt(Date.now() + autoRefreshMin * 60 * 1000);

    // Ticker: every 1s update countdown and trigger refresh when due
    tickerRef.current = setInterval(() => {
      const target = Date.now() + autoRefreshMin * 60 * 1000;
      setNextRunAt((prev) => {
        const target = prev ?? Date.now();
        const remaining = target - Date.now();
        if (remaining <= 0) {
          // trigger auto-refresh (don't await inside setInterval)
          runAutoRefresh();
          return Date.now() + autoRefreshMin * 60 * 1000;
        }
        return prev;
      });
    }, 1000);

    return () => {
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    };
  }, [autoRefreshOn, autoRefreshMin, runAutoRefresh]);

  // Update countdown display every second
  useEffect(() => {
    if (!autoRefreshOn || !nextRunAt) {
      setCountdown("");
      return;
    }
    const tick = () => {
      const remaining = nextRunAt - Date.now();
      if (remaining <= 0) {
        setCountdown("refreshing…");
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${mins}m ${secs.toString().padStart(2, "0")}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [autoRefreshOn, nextRunAt]);

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
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              <Activity className="w-3 h-3 mr-1" /> {screen ? `Last refresh: ${new Date(screen.runAt).toLocaleTimeString("en-IN")}` : "Not run yet"}
            </Badge>
            {autoRefreshOn && (
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 tabular-nums">
                <Clock className="w-3 h-3 mr-1" /> Next: {countdown}
              </Badge>
            )}
            <Button
              variant={notifPermission === "granted" ? "default" : "outline"}
              size="sm"
              onClick={requestNotifPermission}
              // Disable ONLY when we know for sure it's granted/unsupported/denied —
              // initial "loading" state keeps the button enabled (matches SSR render where Notification is undefined)
              disabled={notifPermission === "granted" || notifPermission === "unsupported" || notifPermission === "denied"}
              suppressHydrationWarning
            >
              {notifPermission === "granted" ? <BellRing className="w-4 h-4 mr-2" /> : <Bell className="w-4 h-4 mr-2" />}
              <span suppressHydrationWarning>
                {notifPermission === "granted" ? "Alerts on" : notifPermission === "denied" ? "Blocked" : notifPermission === "unsupported" ? "N/A" : "Alerts"}
              </span>
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant={autoRefreshOn ? "default" : "outline"} size="sm">
                  <Timer className="w-4 h-4 mr-2" />
                  {autoRefreshOn ? `Auto: ${autoRefreshMin}m` : "Auto-refresh"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="end">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="auto-toggle" className="text-sm font-medium">Auto-refresh</Label>
                    <Switch id="auto-toggle" checked={autoRefreshOn} onCheckedChange={setAutoRefreshOn} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Interval</Label>
                    <Select value={String(autoRefreshMin)} onValueChange={(v) => setAutoRefreshMin(Number(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AUTO_REFRESH_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-slate-500">
                    When enabled, the dashboard will re-fetch live Top 10 stocks, re-allocate your capital, and refresh stop-loss status every {autoRefreshMin} min. Stress test also re-runs if you’ve already computed it.
                  </p>
                  {autoRefreshOn && nextRunAt && (
                    <p className="text-xs text-blue-600 font-medium">
                      Next refresh at {new Date(nextRunAt).toLocaleTimeString("en-IN")}
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Button onClick={() => runScreen(false)} disabled={running === "screen"} size="sm">
              <RefreshCw className={`w-4 h-4 mr-2 ${running === "screen" ? "animate-spin" : ""}`} />
              {running === "screen" ? "Running…" : "Run Screen"}
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 mb-6">
            <TabsTrigger value="screen" className="gap-2"><Target className="w-4 h-4" /> Screen</TabsTrigger>
            <TabsTrigger value="alloc" className="gap-2"><Wallet className="w-4 h-4" /> Allocation</TabsTrigger>
            <TabsTrigger value="stops" className="gap-2"><ShieldAlert className="w-4 h-4" /> Stop-Loss</TabsTrigger>
            <TabsTrigger value="stress" className="gap-2"><Zap className="w-4 h-4" /> Stress Test</TabsTrigger>
            <TabsTrigger value="backtest" className="gap-2"><History className="w-4 h-4" /> Backtest</TabsTrigger>
            <TabsTrigger value="risk" className="gap-2"><GitCompare className="w-4 h-4" /> Risk</TabsTrigger>
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

          {/* ============================== Backtest tab ============================== */}
          <TabsContent value="backtest">
            <BacktestPanel backtest={backtest} running={backtestRunning} onRun={runBacktest} />
          </TabsContent>

          {/* ============================== Risk tab ============================== */}
          <TabsContent value="risk">
            <RiskPanel
              correlation={correlation}
              running={correlationRunning}
              onRun={runCorrelation}
              hasAlloc={!!alloc}
              onGoToAlloc={() => setTab("alloc")}
            />
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

/* ---------------------------------------------------------------- BacktestPanel */
function BacktestPanel({ backtest, running, onRun }: {
  backtest: BacktestResponse | null;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><History className="w-5 h-5 text-emerald-600" /> Strategy Backtest — 2 Years</CardTitle>
            <CardDescription>
              Monthly rebalance · equal weight Top 10 · compared vs Nifty 50 benchmark
              {backtest?.cached && " · (cached)"}
            </CardDescription>
          </div>
          <Button onClick={onRun} disabled={running} size="sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${running ? "animate-spin" : ""}`} />
            {running ? "Running…" : backtest ? "Re-run Backtest" : "Run Backtest"}
          </Button>
        </CardHeader>
        <CardContent>
          {!backtest && !running && (
            <div className="text-sm text-slate-500 p-6 text-center">
              Click <b>Run Backtest</b> to replay this strategy every month for the last 2 years.
              <br />
              <span className="text-xs">Takes ~30-60 seconds. Compares equity curve vs Nifty 50, computes CAGR, Sharpe, max drawdown, win rate.</span>
            </div>
          )}
          {running && !backtest && <Skeleton className="h-96 w-full" />}
          {backtest?.error && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <b>Backtest failed:</b> {backtest.error}
            </div>
          )}
          {backtest?.summary && (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <StatCard
                  icon={<TrendingUp className="w-4 h-4" />}
                  label="CAGR (Strategy)"
                  value={`${backtest.summary.cagr_strategy_pct.toFixed(2)}%`}
                  sub={`vs Nifty ${backtest.summary.cagr_benchmark_pct.toFixed(2)}%`}
                  tone="emerald"
                />
                <StatCard
                  icon={<Gauge className="w-4 h-4" />}
                  label="Sharpe Ratio"
                  value={backtest.summary.sharpe.toFixed(2)}
                  sub="annualized"
                />
                <StatCard
                  icon={<TrendingDown className="w-4 h-4" />}
                  label="Max Drawdown"
                  value={`${backtest.summary.max_drawdown_pct.toFixed(2)}%`}
                  sub="peak-to-trough"
                  tone="red"
                />
                <StatCard
                  icon={<Activity className="w-4 h-4" />}
                  label="Win Rate"
                  value={`${backtest.summary.win_rate_pct.toFixed(1)}%`}
                  sub={`${backtest.summary.winners}W / ${backtest.summary.losers}L`}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <StatCard
                  icon={<ArrowUp className="w-4 h-4" />}
                  label="Avg Winner"
                  value={`+${backtest.summary.avg_winner_pct.toFixed(2)}%`}
                  sub="per pick"
                  tone="emerald"
                />
                <StatCard
                  icon={<ArrowDown className="w-4 h-4" />}
                  label="Avg Loser"
                  value={`${backtest.summary.avg_loser_pct.toFixed(2)}%`}
                  sub="per pick"
                  tone="red"
                />
                <StatCard
                  icon={<TrendingUp className="w-4 h-4" />}
                  label="Total Return"
                  value={`+${backtest.summary.total_strategy_ret_pct.toFixed(2)}%`}
                  sub={`vs Nifty ${backtest.summary.total_benchmark_ret_pct.toFixed(2)}%`}
                  tone="emerald"
                />
                <StatCard
                  icon={<Zap className="w-4 h-4" />}
                  label="Excess Return"
                  value={`+${backtest.summary.excess_return_pct.toFixed(2)}%`}
                  sub="alpha vs Nifty"
                  tone="emerald"
                />
              </div>

              {/* Equity curve chart */}
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="text-base">Equity Curve — ₹100 invested 2 years ago</CardTitle>
                  <CardDescription>
                    Strategy (Top 10 momentum, monthly rebalance) vs Nifty 50 buy-and-hold
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={backtest.equity_curve}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(0, 7)} />
                        <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, padding: 8 }}
                          formatter={(v: number, name: string) => [`₹${v.toFixed(2)}`, name === "strategy" ? "Strategy" : "Nifty 50"]}
                        />
                        <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "₹100 start", fontSize: 10, position: "insideTopLeft" }} />
                        <Line type="monotone" dataKey="strategy" stroke="#059669" strokeWidth={2.5} dot={false} name="Strategy" />
                        <Line type="monotone" dataKey="benchmark" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Nifty 50" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Monthly returns table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Monthly Returns — Last 12 Months</CardTitle>
                  <CardDescription>Strategy return vs Nifty 50 per rebalance period</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Strategy %</TableHead>
                        <TableHead className="text-right">Nifty 50 %</TableHead>
                        <TableHead className="text-right">Excess %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {backtest.monthly_returns.map((m, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{m.month}</TableCell>
                          <TableCell className="text-right tabular-nums"><ReturnCell pct={m.strategy_ret} /></TableCell>
                          <TableCell className="text-right tabular-nums"><ReturnCell pct={m.benchmark_ret} /></TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            <ReturnCell pct={m.strategy_ret - m.benchmark_ret} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Last 6 rebalance picks */}
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-base">Recent Rebalance Picks</CardTitle>
                  <CardDescription>Top 10 stocks selected at each of the last 6 rebalances</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {backtest.picks_history.map((p, i) => (
                      <div key={i} className="border border-slate-200 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{p.date}</span>
                          <div className="flex gap-3 text-xs">
                            <span className="text-emerald-600">Strategy: {p.strategy_ret > 0 ? "+" : ""}{p.strategy_ret.toFixed(2)}%</span>
                            <span className="text-slate-500">Nifty: {p.benchmark_ret > 0 ? "+" : ""}{p.benchmark_ret.toFixed(2)}%</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {p.picks.map((s) => (
                            <span key={s} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs font-medium">{s}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <p className="text-xs text-slate-500 mt-4">
                Methodology: Equal-weighted Top 10 stocks passing all 6 momentum rules, rebalanced monthly over {backtest.summary.backtest_period}. {backtest.summary.rebalances} rebalances total.
                Past performance does not guarantee future results.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- RiskPanel */
function RiskPanel({ correlation, running, onRun, hasAlloc, onGoToAlloc }: {
  correlation: CorrelationResponse | null;
  running: boolean;
  onRun: () => void;
  hasAlloc: boolean;
  onGoToAlloc: () => void;
}) {
  if (!hasAlloc) {
    return (
      <Card><CardHeader>
        <CardTitle>Risk Analysis</CardTitle>
        <CardDescription>You need an allocation first. <Button variant="link" className="p-0 h-auto" onClick={onGoToAlloc}>Go to Allocation →</Button></CardDescription>
      </CardHeader></Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><GitCompare className="w-5 h-5 text-emerald-600" /> Correlation Matrix</CardTitle>
            <CardDescription>
              Pairwise correlation of daily returns · last 6 months · {correlation?.nDataPoints ?? 0} data points
            </CardDescription>
          </div>
          <Button onClick={onRun} disabled={running} size="sm" variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${running ? "animate-spin" : ""}`} />
            {running ? "Computing…" : correlation ? "Refresh" : "Compute"}
          </Button>
        </CardHeader>
        <CardContent>
          {running && !correlation && <Skeleton className="h-64 w-full" />}
          {correlation?.error && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <b>Correlation failed:</b> {correlation.error}
            </div>
          )}
          {correlation && !correlation.error && (
            <>
              {/* Top-level risk metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                <StatCard
                  icon={<GitCompare className="w-4 h-4" />}
                  label="Effective Bets"
                  value={correlation.effectiveBets.toFixed(2)}
                  sub={`of ${correlation.symbols.length} holdings`}
                  tone={correlation.effectiveBets < correlation.symbols.length * 0.6 ? "amber" : "emerald"}
                />
                <StatCard
                  icon={<Activity className="w-4 h-4" />}
                  label="Avg Correlation"
                  value={correlation.avgCorrelation.toFixed(3)}
                  sub="mean pairwise ρ"
                  tone={correlation.avgCorrelation > 0.5 ? "red" : correlation.avgCorrelation > 0.3 ? "amber" : "emerald"}
                />
                <StatCard
                  icon={<AlertTriangle className="w-4 h-4" />}
                  label="High-ρ Pairs"
                  value={String(correlation.highCorrelationPairs.length)}
                  sub="|ρ| > 0.70"
                  tone={correlation.highCorrelationPairs.length > 0 ? "amber" : "emerald"}
                />
              </div>

              {/* Hidden concentration warning */}
              {correlation.highCorrelationPairs.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                  <div className="font-medium text-amber-800 mb-1">⚠ Hidden Concentration Detected</div>
                  <p className="text-amber-700 mb-2">
                    These stock pairs move together (|ρ| &gt; 0.70). Even though your sector caps are respected,
                    you effectively have fewer independent bets than your {correlation.symbols.length} holdings suggest.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {correlation.highCorrelationPairs.map((p, i) => (
                      <span key={i} className="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs font-medium">
                        {p.a} ↔ {p.b} (ρ = {p.rho > 0 ? "+" : ""}{p.rho})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Correlation heatmap */}
              <div className="overflow-x-auto">
                <table className="border-collapse text-xs">
                  <thead>
                    <tr>
                      {correlation.matrix[0].map((cell, i) => (
                        <th key={i} className="px-1 py-1 text-slate-500 font-medium sticky left-0 bg-white">
                          {typeof cell === "string" ? cell.slice(0, 6) : cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {correlation.matrix.slice(1).map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => {
                          if (ci === 0) {
                            return (
                              <td key={ci} className="px-2 py-1 font-medium text-slate-700 sticky left-0 bg-white">
                                {typeof cell === "string" ? cell.slice(0, 6) : cell}
                              </td>
                            );
                          }
                          const rho = typeof cell === "number" ? cell : 0;
                          const isDiagonal = ri === ci - 1;
                          const bg = correlationColor(rho);
                          const textColor = Math.abs(rho) > 0.6 ? "text-white" : "text-slate-700";
                          return (
                            <td
                              key={ci}
                              className={`px-2 py-1 text-center tabular-nums ${textColor}`}
                              style={{ backgroundColor: bg, minWidth: 36 }}
                              title={`${row[0]} vs ${correlation.matrix[0][ci]}: ρ = ${rho.toFixed(3)}`}
                            >
                              {isDiagonal ? "1.00" : rho.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-slate-500 mt-4">
                <b>Effective bets</b> = (Σw)² / Σ(wᵢ × wⱼ × ρᵢⱼ) — measures how many truly independent positions you hold.
                Lower than your actual holding count means hidden concentration.
                <br />
                <b>Color scale:</b> green = low correlation (good diversification), red = high correlation (concentration risk).
              </p>
            </>
          )}
          {!correlation && !running && (
            <div className="text-sm text-slate-500 p-6 text-center">
              Click <b>Compute</b> to fetch 6 months of daily returns and analyze correlation.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function correlationColor(rho: number): string {
  // Map [-1, 1] → green (low) → yellow → red (high)
  // For diversification, we care about |rho| mostly, but high positive rho is the real risk
  if (rho >= 0.8) return "#dc2626"; // strong red
  if (rho >= 0.6) return "#f97316"; // orange
  if (rho >= 0.4) return "#facc15"; // yellow
  if (rho >= 0.2) return "#a3e635"; // light green
  if (rho >= 0) return "#86efac";   // pale green
  if (rho >= -0.2) return "#bfdbfe"; // pale blue (negatives = hedge, good)
  if (rho >= -0.4) return "#60a5fa"; // blue
  return "#3b82f6"; // strong blue (great hedge)
}
