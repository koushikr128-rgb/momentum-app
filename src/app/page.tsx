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
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header — compact */}
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-3 sm:px-5 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-foreground truncate">Nifty Momentum Tracker</h1>
              <p className="text-[10px] text-muted-foreground leading-tight truncate">
                High Relative Strength · Strong Trend
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="pastel-positive text-[10px] px-1.5 py-0 h-5 font-medium hidden sm:inline-flex">
              <Activity className="w-2.5 h-2.5 mr-1" />
              {screen ? new Date(screen.runAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
            </Badge>
            {autoRefreshOn && (
              <Badge variant="outline" className="pastel-info text-[10px] px-1.5 py-0 h-5 font-medium tabular-nums">
                <Clock className="w-2.5 h-2.5 mr-1" /> {countdown}
              </Badge>
            )}
            <Button
              variant={notifPermission === "granted" ? "default" : "outline"}
              size="sm"
              onClick={requestNotifPermission}
              disabled={notifPermission === "granted" || notifPermission === "unsupported" || notifPermission === "denied"}
              suppressHydrationWarning
              className="h-7 px-2 text-[11px]"
            >
              {notifPermission === "granted" ? <BellRing className="w-3 h-3 sm:mr-1" /> : <Bell className="w-3 h-3 sm:mr-1" />}
              <span suppressHydrationWarning className="hidden sm:inline">
                {notifPermission === "granted" ? "On" : notifPermission === "denied" ? "Blocked" : notifPermission === "unsupported" ? "N/A" : "Alerts"}
              </span>
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant={autoRefreshOn ? "default" : "outline"} size="sm" className="h-7 px-2 text-[11px]">
                  <Timer className="w-3 h-3 sm:mr-1" />
                  <span className="hidden sm:inline">{autoRefreshOn ? `${autoRefreshMin}m` : "Auto"}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="end">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="auto-toggle" className="text-sm font-medium">Auto-refresh</Label>
                    <Switch id="auto-toggle" checked={autoRefreshOn} onCheckedChange={setAutoRefreshOn} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Interval</Label>
                    <Select value={String(autoRefreshMin)} onValueChange={(v) => setAutoRefreshMin(Number(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AUTO_REFRESH_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Re-fetches live Top 10, re-allocates capital, refreshes stop-loss every {autoRefreshMin} min. Stress + correlation also re-run if open.
                  </p>
                  {autoRefreshOn && nextRunAt && (
                    <p className="text-xs text-primary font-medium">
                      Next refresh at {new Date(nextRunAt).toLocaleTimeString("en-IN")}
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Button onClick={() => runScreen(false)} disabled={running === "screen"} size="sm" className="h-7 px-2.5 text-[11px]">
              <RefreshCw className={`w-3 h-3 sm:mr-1 ${running === "screen" ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{running === "screen" ? "Running…" : "Run Screen"}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Desktop / tablet nav — top tabs, icon + label, hidden on mobile */}
      <nav className="hidden sm:block border-b border-border/60 bg-card/40 sticky top-[49px] z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-5">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid w-full grid-cols-6 h-9 bg-transparent p-0 rounded-none border-b-0">
              <TabsTrigger value="screen" className="gap-1 text-xs py-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md">
                <Target className="w-3.5 h-3.5" /> Screen
              </TabsTrigger>
              <TabsTrigger value="alloc" className="gap-1 text-xs py-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md">
                <Wallet className="w-3.5 h-3.5" /> Allocation
              </TabsTrigger>
              <TabsTrigger value="stops" className="gap-1 text-xs py-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md">
                <ShieldAlert className="w-3.5 h-3.5" /> Stop-Loss
              </TabsTrigger>
              <TabsTrigger value="stress" className="gap-1 text-xs py-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md">
                <Zap className="w-3.5 h-3.5" /> Stress
              </TabsTrigger>
              <TabsTrigger value="backtest" className="gap-1 text-xs py-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md">
                <History className="w-3.5 h-3.5" /> Backtest
              </TabsTrigger>
              <TabsTrigger value="risk" className="gap-1 text-xs py-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md">
                <GitCompare className="w-3.5 h-3.5" /> Risk
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </nav>

      {/* Main content — adds bottom padding on mobile for bottom nav */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-5 py-3 sm:py-4 pb-20 sm:pb-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          {/* ============================== Screen tab ============================== */}
          <TabsContent value="screen" className="mt-0 focus-visible:outline-none">
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

      {/* Footer — desktop only */}
      <footer className="hidden sm:block border-t border-border/60 py-3 text-center text-[10px] text-muted-foreground">
        Live data from Yahoo Finance · RSI(14) Wilder · Universe: Nifty Total Market · Built with Next.js 16
      </footer>

      {/* Mobile bottom nav — app-style */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border/60 backdrop-blur-md safe-area-pb">
        <div className="grid grid-cols-6 h-14">
          {[
            { id: "screen", icon: Target, label: "Screen" },
            { id: "alloc", icon: Wallet, label: "Alloc" },
            { id: "stops", icon: ShieldAlert, label: "Stops" },
            { id: "stress", icon: Zap, label: "Stress" },
            { id: "backtest", icon: History, label: "Btest" },
            { id: "risk", icon: GitCompare, label: "Risk" },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
              >
                <Icon className={`w-4 h-4 ${active ? "stroke-[2.5]" : ""}`} />
                <span className={`text-[9px] ${active ? "font-semibold" : ""}`}>{t.label}</span>
                {active && <div className="absolute top-0 w-8 h-0.5 bg-primary rounded-full" />}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/* ---------------------------------------------------------------- ScreenPanel */
function ScreenPanel({ screen, running }: { screen: ScreenResponse | null; running: boolean }) {
  if (running && !screen) return <Skeleton className="h-96 w-full" />;
  if (!screen) {
    return (
      <Card className="card-pastel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" /> Momentum Screen — Not yet run</CardTitle>
          <CardDescription>
            Click <b>Run Screen</b> at the top to fetch live data for ~{350} NSE stocks and apply the 6 momentum rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground dark:text-muted-foreground/50">Screening rules:</p>
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
      <Card className="card-pastel">
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
                    <TableCell className="font-bold text-muted-foreground/70">{s.rank}</TableCell>
                    <TableCell>
                      <div className="font-semibold">{s.symbol}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1 max-w-[160px]">{s.longName}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">{s.sector}</TableCell>
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
      <Card className="card-pastel"><CardHeader>
        <CardTitle>Portfolio Allocation</CardTitle>
        <CardDescription>Run the screen first to enable allocation.</CardDescription>
      </CardHeader></Card>
    );
  }
  return (
    <div className="space-y-4">
      {/* Investment input */}
      <Card className="card-pastel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" /> Investment Amount</CardTitle>
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
          <Card className="card-pastel">
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
                        <TableCell className="font-bold text-muted-foreground/70">{i + 1}</TableCell>
                        <TableCell className="font-semibold">{s.symbol}</TableCell>
                        <TableCell className="hidden md:table-cell text-muted-foreground">{s.sector}</TableCell>
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
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{s.notes || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Sector breakdown */}
          <Card className="card-pastel">
            <CardHeader>
              <CardTitle>Sector Diversification</CardTitle>
              <CardDescription>Max 25% per sector — ensures no single industry dominates the book</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alloc.sectorBreakdown.map((s) => (
                  <div key={s.sector} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{s.sector} <span className="text-muted-foreground">({s.count} stock{s.count > 1 ? "s" : ""})</span></span>
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
      <Card className="card-pastel"><CardHeader>
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

      <Card className="card-pastel">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-primary" /> Stop-Loss Status</CardTitle>
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
                      <TableCell className="text-right tabular-nums text-[var(--color-pastel-red-text)]">{fmt(s.activeStop)}</TableCell>
                      <TableCell className="text-right tabular-nums"><ReturnCell pct={s.pnlPct} /></TableCell>
                      <TableCell className="text-right hidden sm:table-cell tabular-nums"><ReturnCell pct={s.pnlRupees} rupeeMode /></TableCell>
                      <TableCell className="text-center"><StatusBadge status={s.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {stops.stops.some((s) => s.reasons) && (
                <div className="mt-4 p-3 rounded-lg pastel-warning border text-xs">
                  <div className="font-medium text-[var(--color-pastel-amber-text)] mb-1">⚠ Watch / Exit reasons:</div>
                  <ul className="space-y-1 text-[var(--color-pastel-amber-text)]">
                    {stops.stops.filter((s) => s.reasons).map((s) => (
                      <li key={s.symbol}><b>{s.symbol}</b>: {s.reasons}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground p-6 text-center">
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
      <Card className="card-pastel"><CardHeader>
        <CardTitle>Stress Test</CardTitle>
        <CardDescription>You need an allocation first. <Button variant="link" className="p-0 h-auto" onClick={onGoToAlloc}>Go to Allocation →</Button></CardDescription>
      </CardHeader></Card>
    );
  }
  return (
    <div className="space-y-4">
      <Card className="card-pastel">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Zap className="w-5 h-5 text-[var(--color-pastel-amber-text)]" /> Stress Test Scenarios</CardTitle>
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
                  <Card key={sc.name} className={sc.drawdownPct > 15 ? " pastel-negative/50" : sc.drawdownPct > 10 ? " pastel-warning/50" : ""}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-semibold text-sm">{sc.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{sc.description}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">Drawdown</div>
                          <div className={`font-bold tabular-nums ${sc.drawdownPct > 15 ? "text-[var(--color-pastel-red-text)]" : sc.drawdownPct > 10 ? "text-[var(--color-pastel-amber-text)]" : "text-foreground"}`}>
                            {sc.drawdownPct.toFixed(2)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">₹ Loss</div>
                          <div className="font-bold tabular-nums text-[var(--color-pastel-red-text)]">{fmtINR(sc.totalLoss)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground"># Stocks hit</div>
                          <div className="font-semibold tabular-nums">{sc.stocksHit}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Worst stock</div>
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
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Worst-case drawdown</div>
                      <div className="text-2xl font-bold text-[var(--color-pastel-red-text)]">{stress.worstDrawdown.toFixed(2)}%</div>
                      <div className="text-xs text-muted-foreground">{fmtINR(Math.abs(stress.worstLoss))} loss</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Recommended cash buffer</div>
                      <div className="text-2xl font-bold text-[var(--color-pastel-amber-text)]">{fmtINR(Math.abs(stress.worstLoss))}</div>
                      <div className="text-xs text-muted-foreground">to survive worst case</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="text-sm text-muted-foreground p-6 text-center">
              Click <b>Run Stress Test</b> to simulate 5 adverse scenarios against your current allocation.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-scenario detail tables */}
      {stress && (
        <Card className="card-pastel">
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
                            <TableCell className="text-right tabular-nums text-[var(--color-pastel-red-text)]">{(d.shockPct * 100).toFixed(0)}%</TableCell>
                            <TableCell className="text-right tabular-nums text-[var(--color-pastel-red-text)]">{fmtINR(d.rupeeLoss)}</TableCell>
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
  const toneBg = tone === "emerald" ? "pastel-positive" : tone === "amber" ? "pastel-warning" : tone === "red" ? "pastel-negative" : "";
  const toneText = tone === "emerald" ? "text-[var(--color-pastel-green-text)]" : tone === "amber" ? "text-[var(--color-pastel-amber-text)]" : tone === "red" ? "text-[var(--color-pastel-red-text)]" : "text-foreground";
  return (
    <Card className="card-pastel">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">{label}</span>
          <span className={`${toneBg} rounded-md p-0.5 ${tone === "emerald" || tone === "amber" || tone === "red" ? "" : "bg-muted"} flex items-center`}>{icon}</span>
        </div>
        <div className={`text-base font-bold tabular-nums leading-tight ${toneText}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ReturnCell({ pct, rupeeMode }: { pct: number; rupeeMode?: boolean }) {
  if (isNaN(pct)) return <span className="text-muted-foreground">—</span>;
  const positive = pct >= 0;
  const cls = positive ? "pastel-positive" : "pastel-negative";
  const Icon = positive ? ArrowUp : ArrowDown;
  const val = rupeeMode
    ? `${pct >= 0 ? "+" : "−"}₹${Math.abs(Math.round(pct)).toLocaleString("en-IN")}`
    : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums px-1.5 py-0.5 rounded text-[10px] ${cls}`}>
      <Icon className="w-2.5 h-2.5" />
      {val}
    </span>
  );
}

function RsiBadge({ rsi }: { rsi: number }) {
  const cls = rsi > 80 ? "pastel-negative" : rsi > 70 ? "pastel-warning" : rsi > 55 ? "pastel-positive" : "pastel-purple";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold tabular-nums ${cls}`}>{rsi.toFixed(1)}</span>;
}

function StatusBadge({ status }: { status: "HOLD" | "WATCH" | "EXIT" }) {
  const map = {
    HOLD: "pastel-positive",
    WATCH: "pastel-warning",
    EXIT: "pastel-negative",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${map[status]}`}>{status}</span>;
}

/* ---------------------------------------------------------------- BacktestPanel */
function BacktestPanel({ backtest, running, onRun }: {
  backtest: BacktestResponse | null;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="card-pastel">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><History className="w-5 h-5 text-primary" /> Strategy Backtest — 2 Years</CardTitle>
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
            <div className="text-sm text-muted-foreground p-6 text-center">
              Click <b>Run Backtest</b> to replay this strategy every month for the last 2 years.
              <br />
              <span className="text-xs">Takes ~30-60 seconds. Compares equity curve vs Nifty 50, computes CAGR, Sharpe, max drawdown, win rate.</span>
            </div>
          )}
          {running && !backtest && <Skeleton className="h-96 w-full" />}
          {backtest?.error && (
            <div className="p-4 rounded-lg pastel-negative border text-sm text-[var(--color-pastel-red-text)]">
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
              <Card className="card-pastel">
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
                      <div key={i} className="border border-border/60 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{p.date}</span>
                          <div className="flex gap-3 text-xs">
                            <span className="text-primary">Strategy: {p.strategy_ret > 0 ? "+" : ""}{p.strategy_ret.toFixed(2)}%</span>
                            <span className="text-muted-foreground">Nifty: {p.benchmark_ret > 0 ? "+" : ""}{p.benchmark_ret.toFixed(2)}%</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {p.picks.map((s) => (
                            <span key={s} className="px-2 py-0.5 bg-muted text-foreground rounded text-xs font-medium">{s}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <p className="text-xs text-muted-foreground mt-4">
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
      <Card className="card-pastel"><CardHeader>
        <CardTitle>Risk Analysis</CardTitle>
        <CardDescription>You need an allocation first. <Button variant="link" className="p-0 h-auto" onClick={onGoToAlloc}>Go to Allocation →</Button></CardDescription>
      </CardHeader></Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="card-pastel">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><GitCompare className="w-5 h-5 text-primary" /> Correlation Matrix</CardTitle>
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
            <div className="p-4 rounded-lg pastel-negative border text-sm text-[var(--color-pastel-red-text)]">
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
                <div className="mb-4 p-3 rounded-lg pastel-warning border text-sm">
                  <div className="font-medium text-[var(--color-pastel-amber-text)] mb-1">⚠ Hidden Concentration Detected</div>
                  <p className="text-[var(--color-pastel-amber-text)] mb-2">
                    These stock pairs move together (|ρ| &gt; 0.70). Even though your sector caps are respected,
                    you effectively have fewer independent bets than your {correlation.symbols.length} holdings suggest.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {correlation.highCorrelationPairs.map((p, i) => (
                      <span key={i} className="px-2 py-1 pastel-warning text-[var(--color-pastel-amber-text)] rounded text-xs font-medium">
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
                        <th key={i} className="px-1 py-1 text-muted-foreground font-medium sticky left-0 bg-white">
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
                              <td key={ci} className="px-2 py-1 font-medium text-foreground sticky left-0 bg-white">
                                {typeof cell === "string" ? cell.slice(0, 6) : cell}
                              </td>
                            );
                          }
                          const rho = typeof cell === "number" ? cell : 0;
                          const isDiagonal = ri === ci - 1;
                          const bg = correlationColor(rho);
                          const textColor = Math.abs(rho) > 0.6 ? "text-white" : "text-foreground";
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

              <p className="text-xs text-muted-foreground mt-4">
                <b>Effective bets</b> = (Σw)² / Σ(wᵢ × wⱼ × ρᵢⱼ) — measures how many truly independent positions you hold.
                Lower than your actual holding count means hidden concentration.
                <br />
                <b>Color scale:</b> green = low correlation (good diversification), red = high correlation (concentration risk).
              </p>
            </>
          )}
          {!correlation && !running && (
            <div className="text-sm text-muted-foreground p-6 text-center">
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
