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
  Bell, BellRing, History, GitCompare, SlidersHorizontal, Search,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

import { ScreenedStock, AllocationStock, StopLossStock, StressScenario, SetupType, SetupGrade } from "@/lib/indicators";
import type { RegimeState } from "@/lib/regime";

type ScreenResponse = {
  universeSize: number;
  passedData: number;
  passedTech: number;
  passedMc: number;
  top10: ScreenedStock[];
  runAt: string;
  elapsedMs: number;
  error?: string;
  warning?: string;
  stale?: boolean;
  fallback?: boolean;
  cached?: boolean;
};

type ScreenChange = {
  date: string;          // ISO timestamp when the change was detected
  added: Array<{ symbol: string; ret6mPct: number }>;
  removed: string[];     // just symbols (we don't have full data for removed stocks)
};

type RemovedStock = {
  symbol: string;
  sector: string;
  currentPrice: number;
  attemptedRupees: number;
  attemptedWeight: number;
  reason: string;
};

type AllocateResponse = {
  allocation: AllocationStock[];
  removedStocks: RemovedStock[];
  mode?: "risk-parity" | "momentum";
  totalInvested: number;
  totalAllocated: number;
  cashLeftover: number;
  sectorBreakdown: Array<{ sector: string; weight: number; count: number; rupees: number }>;
};

type RebalanceAction = "BUY MORE" | "HOLD" | "TRIM 30%" | "TRIM 60%" | "EXIT" | "INITIATE";

type RebalanceItem = {
  symbol: string;
  longName: string;
  sector: string;
  action: RebalanceAction;
  currentPrice: number;
  entryPrice?: number;
  pnlPct?: number;
  currentMomentum: number;
  previousMomentum?: number;
  momentumDelta?: number;
  currentShares?: number;
  targetShares: number;
  sharesChange: number;
  rupeesChange: number;
  reason: string;
};

type RebalanceResult = {
  items: RebalanceItem[];
  summary: {
    buyMore: number;
    hold: number;
    trim30: number;
    trim60: number;
    exit: number;
    initiate: number;
    totalBuyRupees: number;
    totalSellRupees: number;
    netCashflow: number;
  };
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
const IST = "Asia/Kolkata";
const fmtISTTime = (d: string | Date) => new Date(d).toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit" });
const fmtISTDateTime = (d: string | Date) => new Date(d).toLocaleString("en-IN", { timeZone: IST, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtISTDate = (d: string | Date) => new Date(d).toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
const fmtISTDateShort = (d: string | Date) => new Date(d).toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit", month: "short" });

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
  const [prevScreenSymbols, setPrevScreenSymbols] = useState<string[] | null>(null);
  const [changeHistory, setChangeHistory] = useState<ScreenChange[]>([]);
  const [heldStocks, setHeldStocks] = useState<HeldStock[]>([]);
  const heldStocksRef = useRef<HeldStock[]>([]);
  const screenRef = useRef<ScreenResponse | null>(null);
  const [alloc, setAlloc] = useState<AllocateResponse | null>(null);
  const [stops, setStops] = useState<StopsResponse | null>(null);
  const [stress, setStress] = useState<StressResponse | null>(null);
  const [totalInvestment, setTotalInvestment] = useState(200000);
  const [topN, setTopN] = useState(10);  // ← NEW: customizable portfolio size
  const [allocDirty, setAllocDirty] = useState(false);

  // Filter thresholds (loosened defaults yield ~25 qualifiers)
  const [filters, setFilters] = useState({ rsiMin: 50, mcapMin: 200, volMin: 20000 });

  // Allocation mode: "risk-parity" (inverse-vol) or "momentum" (momentum-weighted)
  const [allocationMode, setAllocationMode] = useState<"risk-parity" | "momentum">("risk-parity");

  // Rebalance state
  const [rebalance, setRebalance] = useState<RebalanceResult | null>(null);
  const [rebalanceRunning, setRebalanceRunning] = useState(false);
  const [showZerodhaDialog, setShowZerodhaDialog] = useState(false);
  const [kiteToken, setKiteToken] = useState("");
  const [kiteConnecting, setKiteConnecting] = useState(false);
  const [kiteConnected, setKiteConnected] = useState(false);

  // ===== Phase 1: Market Regime + Analyze state =====
  const kiteAccessTokenRef = useRef<string>("");
  const [regime, setRegime] = useState<RegimeState | null>(null);
  const [regimeLoading, setRegimeLoading] = useState(false);
  const [regimeError, setRegimeError] = useState<string | null>(null);

  // Analyze state
  const [analyzeSymbol, setAnalyzeSymbol] = useState<string>("");
  const [analyzeInput, setAnalyzeInput] = useState<string>("");
  const [analyzeData, setAnalyzeData] = useState<ScreenedStock | null>(null);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeSuggestions, setAnalyzeSuggestions] = useState<string[]>([]);

  // R:R override (null = use per-setup presets)
  const [rrOverride, setRrOverride] = useState<{ t1: number; t2: number } | null>(null);

  // Screen mode: "momentum" (Phase 1) or "bridge" (Pullback Bridge screener)
  const [screenMode, setScreenMode] = useState<"momentum" | "bridge">("momentum");

  const fetchRegime = useCallback(async () => {
    setRegimeLoading(true);
    setRegimeError(null);
    try {
      const headers: Record<string, string> = {};
      if (kiteAccessTokenRef.current) {
        headers["x-kite-token"] = kiteAccessTokenRef.current;
      }
      const res = await fetch("/api/regime", { headers, cache: "no-store" });
      const data = await res.json();
      if (!res.ok && data?.error) {
        setRegimeError(data.error);
      }
      setRegime(data as RegimeState);
      return data as RegimeState;
    } catch (e: any) {
      setRegimeError(e?.message || "Failed to fetch regime");
      return null;
    } finally {
      setRegimeLoading(false);
    }
  }, []);

  // On mount: restore kite token from localStorage, check status, fetch regime
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem("kite_access_token");
      if (storedToken) kiteAccessTokenRef.current = storedToken;
    } catch {}

    // Check Zerodha status
    fetch("/api/zerodha/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.connected) {
          setKiteConnected(true);
        } else if (d?.reason === "token_expired") {
          // Token cookie may have expired — clear local ref
          try { localStorage.removeItem("kite_access_token"); } catch {}
          kiteAccessTokenRef.current = "";
        }
      })
      .catch(() => {});

    // Initial regime fetch
    fetchRegime();
  }, [fetchRegime]);

  // Auto-retry regime every 30s while niftyClose === 0 (limited data)
  useEffect(() => {
    if (regime && regime.niftyClose > 0) return;
    const id = setInterval(() => {
      fetchRegime();
    }, 30000);
    return () => clearInterval(id);
  }, [regime, fetchRegime]);

  const runAnalyze = useCallback(async (symbol: string) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setAnalyzeLoading(true);
    setAnalyzeError(null);
    setAnalyzeData(null);
    setAnalyzeSuggestions([]);
    setAnalyzeSymbol(sym);
    setAnalyzeInput(sym);
    try {
      const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setAnalyzeError(data?.error || `Analyze failed (${res.status})`);
        if (Array.isArray(data?.suggestions)) setAnalyzeSuggestions(data.suggestions);
      } else {
        setAnalyzeData(data as ScreenedStock);
      }
    } catch (e: any) {
      setAnalyzeError(e?.message || "Network error");
    } finally {
      setAnalyzeLoading(false);
    }
  }, []);

  // On mount: check URL for Zerodha callback token
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const zerodhaStatus = params.get("zerodha");
      const requestToken = params.get("request_token");

      if (zerodhaStatus === "token" && requestToken) {
        // Auto-connect with the token from URL
        setShowZerodhaDialog(true);
        setKiteToken(requestToken);
        setKiteConnecting(true);

        fetch("/api/zerodha/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_token: requestToken }),
        })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              if (data?.access_token) {
                try { localStorage.setItem("kite_access_token", data.access_token); } catch {}
                kiteAccessTokenRef.current = data.access_token;
              }
              setKiteConnected(true);
              setKiteConnecting(false);
              toast({ title: "Connected to Zerodha!", description: "You can now use Zerodha data source" });
              setTimeout(() => fetchRegime(), 500);
            } else {
              const err = await res.json();
              setKiteConnecting(false);
              toast({ title: "Zerodha connection failed", description: err.error || "Unknown error", variant: "destructive" });
            }
          })
          .catch(() => {
            setKiteConnecting(false);
            toast({ title: "Connection failed", description: "Network error", variant: "destructive" });
          });

        // Clean the URL (remove query params)
        window.history.replaceState({}, "", "/");
      } else if (zerodhaStatus === "error") {
        setShowZerodhaDialog(true);
        toast({ title: "Zerodha authorization failed", description: "Please try again", variant: "destructive" });
        window.history.replaceState({}, "", "/");
      }
    } catch {}
  }, []);

  // Auto-load state (effect is defined AFTER runScreen below to avoid TDZ error)
  const [elapsedMs, setElapsedMs] = useState(0);

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

  // Load change history from localStorage on mount (persists across sessions)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("nifty_change_history");
      if (stored) {
        const parsed = JSON.parse(stored) as ScreenChange[];
        if (Array.isArray(parsed)) setChangeHistory(parsed);
      }
    } catch { /* ignore parse errors */ }
  }, []);

  // Save change history to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem("nifty_change_history", JSON.stringify(changeHistory.slice(-20)));
    } catch { /* storage full or unavailable */ }
  }, [changeHistory]);

  const runScreen = useCallback(async (silent = false, topNOverride?: number, filtersOverride?: typeof filters, modeOverride?: "momentum" | "bridge") => {
    setRunning("screen");
    const mode = modeOverride ?? screenMode;
    // Start elapsed timer so progress bar updates live
    const startTime = Date.now();
    setElapsedMs(0);
    const elapsedInterval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 500);
    try {
      const n = topNOverride ?? topN;
      const f = filtersOverride ?? filters;
      const qs = new URLSearchParams({
        topN: String(n),
        rsiMin: String(f.rsiMin),
        mcapMin: String(f.mcapMin),
        volMin: String(f.volMin),
      });
      const endpoint = mode === "bridge" ? "/api/bridge-screen" : "/api/screen";
      // Bridge screen takes ~70s — use AbortController with 120s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      const res = await fetch(`${endpoint}?${qs}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`Screen failed (${res.status})`);
      const data: ScreenResponse = await res.json();
      const prev = screenRef.current;
      if (prev && prev.top10.length > 0 && data.top10.length > 0) {
        const prevSyms = prev.top10.map((s) => s.symbol);
        const currentSyms = data.top10.map((s) => s.symbol);
        const added = currentSyms.filter((s) => !prevSyms.includes(s));
        const removed = prevSyms.filter((s) => !currentSyms.includes(s));
        if (added.length > 0 || removed.length > 0) {
          const change: ScreenChange = {
            date: new Date().toISOString(),
            added: added.map((sym) => {
              const stock = data.top10.find((s) => s.symbol === sym);
              return { symbol: sym, ret6mPct: stock?.ret6mPct ?? 0 };
            }),
            removed,
          };
          setChangeHistory((prev) => [...prev, change].slice(-20));
        }
        setPrevScreenSymbols(prevSyms);
      }
      screenRef.current = data;
      setScreen(data);
      setAllocDirty(true);
      if (!silent) {
        if (data.error) {
          toast({ title: "Screen failed — Yahoo rate-limited", description: data.error.slice(0, 100), variant: "destructive" });
        } else if (data.warning) {
          toast({ title: "Showing cached data", description: data.warning.slice(0, 100) });
        } else {
          const label = mode === "bridge" ? "Bridge screen" : "Screen";
          toast({ title: `${label} complete`, description: `${data.top10.length} stocks in Top ${n}` });
        }
      }
      return data;
    } catch (e: any) {
      const msg = e?.name === "AbortError"
        ? "Screen timed out after 120s — Yahoo may be rate-limiting. Try again."
        : e instanceof Error ? e.message : "Unknown";
      toast({ title: "Screen failed", description: msg, variant: "destructive" });
      return null;
    } finally {
      clearInterval(elapsedInterval);
      setRunning(null);
    }
  }, [topN, filters, screenMode]);

  // MANDATORY: Do NOT auto-fetch on mount. Restore from localStorage only.
  // Screen ONLY refreshes when user clicks Run Screen, auto-refresh is ON,
  // or user changes Top N / filters. NEVER add runScreen() here.
  useEffect(() => {
    try {
      const s = localStorage.getItem("nifty_last_screen");
      if (s) { const p = JSON.parse(s); if (p?.top10?.length > 0) { screenRef.current = p; setScreen(p); } }
      const h = localStorage.getItem("nifty_held_stocks");
      if (h) { const ph = JSON.parse(h); if (Array.isArray(ph)) { setHeldStocks(ph); heldStocksRef.current = ph; } }
      const c = localStorage.getItem("nifty_change_history");
      if (c) { const pc = JSON.parse(c); if (Array.isArray(pc)) setChangeHistory(pc); }
    } catch {}
  }, []);
  useEffect(() => { if (screen?.top10?.length > 0) try { localStorage.setItem("nifty_last_screen", JSON.stringify(screen)); } catch {} }, [screen]);
  useEffect(() => { try { localStorage.setItem("nifty_held_stocks", JSON.stringify(heldStocks)); } catch {} }, [heldStocks]);
  useEffect(() => { try { localStorage.setItem("nifty_change_history", JSON.stringify(changeHistory.slice(-20))); } catch {} }, [changeHistory]);

  const runAllocation = useCallback(async (silent = false, modeOverride?: "risk-parity" | "momentum") => {
    if (!screen) return;
    try {
      const mode = modeOverride ?? allocationMode;
      const res = await fetch("/api/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks: screen.top10, totalInvestment, mode }),
      });
      if (!res.ok) throw new Error("Allocation failed");
      const data: AllocateResponse = await res.json();
      setAlloc(data);
      setAllocDirty(false);
      // Invalidate rebalance since allocation changed
      setRebalance(null);
      if (!silent) {
        toast({ title: "Allocation computed", description: `${fmtINR(data.totalInvested)} across ${data.allocation.length} stocks (${mode === "momentum" ? "momentum-weighted" : "risk parity"})` });
      }
      return data;
    } catch (e) {
      if (!silent) {
        toast({ title: "Allocation failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
      }
      return null;
    }
  }, [screen, totalInvestment, allocationMode]);

  const runRebalance = useCallback(async () => {
    if (!alloc || !screen) return;
    setRebalanceRunning(true);
    try {
      const res = await fetch("/api/rebalance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocation: alloc.allocation,
          screen: screen.top10,
          totalInvestment: alloc.totalInvested,
        }),
      });
      if (!res.ok) throw new Error("Rebalance failed");
      const data: RebalanceResult = await res.json();
      setRebalance(data);
      const s = data.summary;
      toast({
        title: "Rebalance computed",
        description: `${s.buyMore} buy more · ${s.hold} hold · ${s.trim30 + s.trim60} trim · ${s.exit} exit · ${s.initiate} new`,
      });
    } catch (e) {
      toast({ title: "Rebalance failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally {
      setRebalanceRunning(false);
    }
  }, [alloc, screen]);

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
      description: `Next refresh in ${autoRefreshMin} min · ${fmtISTTime(Date.now() + autoRefreshMin * 60 * 1000)}`,
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
              {running === "screen" && !screen
                ? `Loading ${elapsedMs ? (elapsedMs / 1000).toFixed(0) : 0}s…`
                : screen
                  ? fmtISTTime(screen.runAt)
                  : "—"}
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
            {/* Zerodha connect button — opens dialog with OAuth + manual token options */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] gap-1"
              onClick={() => setShowZerodhaDialog(true)}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="hidden sm:inline">Zerodha</span>
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
                      Next refresh at {fmtISTTime(nextRunAt)}
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {/* Screen mode toggle: Momentum vs Pullback Bridge */}
            <div className="flex items-center rounded-md border border-border/60 overflow-hidden">
              <button
                onClick={() => {
                  if (screenMode !== "momentum") {
                    setScreenMode("momentum");
                    setScreen(null);
                    screenRef.current = null;
                  }
                }}
                className={`px-2 py-1 text-[10px] font-medium transition-colors ${screenMode === "momentum" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                Momentum
              </button>
              <button
                onClick={() => {
                  if (screenMode !== "bridge") {
                    setScreenMode("bridge");
                    setScreen(null);
                    screenRef.current = null;
                  }
                }}
                className={`px-2 py-1 text-[10px] font-medium transition-colors ${screenMode === "bridge" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                Bridge
              </button>
            </div>
            <Button onClick={() => runScreen(false)} disabled={running === "screen"} size="sm" className="h-7 px-2.5 text-[11px]">
              <RefreshCw className={`w-3 h-3 sm:mr-1 ${running === "screen" ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{running === "screen" ? "Running…" : screenMode === "bridge" ? "Run Bridge" : "Run Screen"}</span>
            </Button>
            {/* Top N selector — pick portfolio size (5/10/15/20/25/30 stocks) */}
            <div className="flex items-center gap-1">
              <Label htmlFor="topn-select" className="text-[10px] text-muted-foreground hidden sm:inline">Top</Label>
              <Select value={String(topN)} onValueChange={(v) => {
                const newN = Number(v);
                setTopN(newN);
                // Auto-run screen with new N if user has already run it once
                if (screen) {
                  toast({ title: `Switching to Top ${newN}`, description: "Re-running screen…" });
                  runScreen(false, newN);
                }
              }}>
                <SelectTrigger id="topn-select" className="h-7 w-[52px] text-[11px] px-1.5 py-0 gap-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 10, 15, 20, 25, 30].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label htmlFor="topn-select" className="text-[10px] text-muted-foreground hidden sm:inline">stocks</Label>
            </div>
            {/* Filters popover — adjustable RSI, MCap, Vol thresholds */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]">
                  <SlidersHorizontal className="w-3 h-3 sm:mr-1" />
                  <span className="hidden sm:inline">Filters</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-medium">Min RSI(14)</Label>
                      <span className="text-xs font-bold tabular-nums text-primary">{filters.rsiMin}</span>
                    </div>
                    <input
                      type="range" min={40} max={70} step={5}
                      value={filters.rsiMin}
                      onChange={(e) => setFilters({ ...filters, rsiMin: Number(e.target.value) })}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-[9px] text-muted-foreground">
                      <span>40 (loose)</span>
                      <span>55 (original)</span>
                      <span>70 (strict)</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-medium">Min Market Cap (₹ Cr)</Label>
                      <span className="text-xs font-bold tabular-nums text-primary">₹{filters.mcapMin}</span>
                    </div>
                    <input
                      type="range" min={100} max={2000} step={100}
                      value={filters.mcapMin}
                      onChange={(e) => setFilters({ ...filters, mcapMin: Number(e.target.value) })}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-[9px] text-muted-foreground">
                      <span>₹100</span>
                      <span>₹500 (orig)</span>
                      <span>₹2,000</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-medium">Min 30D Avg Volume</Label>
                      <span className="text-xs font-bold tabular-nums text-primary">{filters.volMin.toLocaleString("en-IN")}</span>
                    </div>
                    <input
                      type="range" min={10000} max={100000} step={5000}
                      value={filters.volMin}
                      onChange={(e) => setFilters({ ...filters, volMin: Number(e.target.value) })}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-[9px] text-muted-foreground">
                      <span>10k</span>
                      <span>50k (orig)</span>
                      <span>100k</span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-border/40">
                    <Button
                      size="sm"
                      className="h-7 flex-1 text-[11px]"
                      onClick={() => {
                        setFilters({ rsiMin: 50, mcapMin: 200, volMin: 20000 });
                        toast({ title: "Reset to loosened defaults", description: "RSI>50, MCap>₹200Cr, Vol>20k" });
                      }}
                      variant="outline"
                    >
                      Reset defaults
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 flex-1 text-[11px]"
                      onClick={() => {
                        setFilters({ rsiMin: 55, mcapMin: 500, volMin: 50000 });
                        toast({ title: "Restored original strategy", description: "RSI>55, MCap>₹500Cr, Vol>50k" });
                      }}
                      variant="outline"
                    >
                      Original (strict)
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    className="h-8 w-full text-[11px]"
                    onClick={() => runScreen(false, undefined, filters)}
                    disabled={running === "screen"}
                  >
                    <RefreshCw className={`w-3 h-3 mr-1.5 ${running === "screen" ? "animate-spin" : ""}`} />
                    Apply &amp; Re-run Screen
                  </Button>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Loosened defaults (RSI&gt;50, MCap&gt;₹200Cr, Vol&gt;20k) typically yield 25-30 qualifiers from the 511-stock universe.
                    Original strategy rules (RSI&gt;55, MCap&gt;₹500Cr, Vol&gt;50k) typically yield 10-12.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </header>

      {/* Desktop / tablet nav — top tabs, icon + label, hidden on mobile */}
      <nav className="hidden sm:block border-b border-border/60 bg-card/40 sticky top-[49px] z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-5">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid w-full grid-cols-7 h-9 bg-transparent p-0 rounded-none border-b-0">
              <TabsTrigger value="screen" className="gap-1 text-xs py-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md">
                <Target className="w-3.5 h-3.5" /> Screen
              </TabsTrigger>
              <TabsTrigger value="alloc" className="gap-1 text-xs py-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md">
                <Wallet className="w-3.5 h-3.5" /> Allocation
              </TabsTrigger>
              <TabsTrigger value="analyze" className="gap-1 text-xs py-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md">
                <Search className="w-3.5 h-3.5" /> Analyze
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
        <RegimeBanner regime={regime} loading={regimeLoading} error={regimeError} onRefresh={fetchRegime} />
        <Tabs value={tab} onValueChange={setTab} className="w-full mt-3">
          {/* ============================== Screen tab ============================== */}
          <TabsContent value="screen" className="mt-0 focus-visible:outline-none">
            <ScreenPanel screen={screen} running={running === "screen"} topN={topN} filters={filters} elapsedMs={elapsedMs} prevScreenSymbols={prevScreenSymbols} changeHistory={changeHistory} onClearHistory={() => setChangeHistory([])} regime={regime} onAnalyze={(sym) => { setTab("analyze"); runAnalyze(sym); }} rrOverride={rrOverride} setRrOverride={setRrOverride} screenMode={screenMode} />
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
              allocationMode={allocationMode}
              setAllocationMode={setAllocationMode}
              rebalance={rebalance}
              runRebalance={runRebalance}
              rebalanceRunning={rebalanceRunning}
            />
          </TabsContent>

          {/* ============================== Analyze tab ============================== */}
          <TabsContent value="analyze" className="mt-0 focus-visible:outline-none">
            <AnalyzePanel
              input={analyzeInput}
              setInput={setAnalyzeInput}
              onAnalyze={runAnalyze}
              symbol={analyzeSymbol}
              data={analyzeData}
              loading={analyzeLoading}
              error={analyzeError}
              regime={regime}
              suggestions={analyzeSuggestions}
              rrOverride={rrOverride}
              setRrOverride={setRrOverride}
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

      {/* Zerodha Connect Dialog */}
      {showZerodhaDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowZerodhaDialog(false)}>
          <div className="bg-card rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">Connect Zerodha</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Connect your Zerodha account for real-time data, no rate limits, and live portfolio sync.
            </p>

            {kiteConnected ? (
              <div className="text-center py-4">
                <div className="text-2xl mb-2">✅</div>
                <p className="text-sm font-medium text-emerald-600">Connected to Zerodha!</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowZerodhaDialog(false)}>
                  Close
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Option 1: OAuth login */}
                <div>
                  <a href="/api/zerodha/login">
                    <Button className="w-full" variant="default">
                      Login with Zerodha
                    </Button>
                  </a>
                  <p className="text-[10px] text-muted-foreground mt-1 text-center">
                    Redirects to Zerodha login page
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-border/40" />
                  <span className="text-[10px] text-muted-foreground">OR</span>
                  <div className="flex-1 h-px bg-border/40" />
                </div>

                {/* Option 2: Manual — paste the full redirect URL or just the token */}
                <div>
                  <Label className="text-xs font-medium">Manual: Paste URL or Token</Label>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    1. Click this link:{" "}
                    <a href="https://kite.zerodha.com/connect/login?api_key=mrotfrt78mmjv00p&v=3" target="_blank" className="text-primary underline">
                      Open Zerodha Login
                    </a><br />
                    2. Log in and authorize<br />
                    3. Copy the ENTIRE URL from the address bar (even if it shows an error page)<br />
                    4. Paste it below
                  </p>
                  <Input
                    placeholder="Paste the full URL here..."
                    value={kiteToken}
                    onChange={(e) => setKiteToken(e.target.value)}
                    className="text-xs"
                  />
                  <Button
                    className="w-full mt-2"
                    variant="outline"
                    size="sm"
                    disabled={!kiteToken.trim() || kiteConnecting}
                    onClick={async () => {
                      setKiteConnecting(true);
                      try {
                        // Extract request_token from URL or use as-is
                        let token = kiteToken.trim();
                        if (token.includes("request_token=")) {
                          try {
                            const url = new URL(token);
                            token = url.searchParams.get("request_token") || token;
                          } catch {
                            // Not a valid URL, try regex
                            const match = token.match(/request_token=([^&]+)/);
                            if (match) token = match[1];
                          }
                        }

                        const res = await fetch("/api/zerodha/token", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ request_token: token }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          if (data?.access_token) {
                            try { localStorage.setItem("kite_access_token", data.access_token); } catch {}
                            kiteAccessTokenRef.current = data.access_token;
                          }
                          setKiteConnected(true);
                          toast({ title: "Connected to Zerodha!", description: "You can now use Zerodha data source" });
                          setTimeout(() => fetchRegime(), 500);
                        } else {
                          const err = await res.json();
                          toast({ title: "Connection failed", description: err.error || "Unknown error", variant: "destructive" });
                        }
                      } catch {
                        toast({ title: "Connection failed", description: "Network error", variant: "destructive" });
                      } finally {
                        setKiteConnecting(false);
                      }
                    }}
                  >
                    {kiteConnecting ? "Connecting..." : "Connect"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer — desktop only */}
      <footer className="hidden sm:block border-t border-border/60 py-3 text-center text-[10px] text-muted-foreground">
        Live data from Yahoo Finance / Zerodha Kite · RSI(14) Wilder · Universe: Nifty Total Market · Built with Next.js 16
      </footer>

      {/* Mobile bottom nav — app-style */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border/60 backdrop-blur-md safe-area-pb">
        <div className="grid grid-cols-7 h-14">
          {[
            { id: "screen", icon: Target, label: "Screen" },
            { id: "alloc", icon: Wallet, label: "Alloc" },
            { id: "analyze", icon: Search, label: "Analyze" },
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

/* ---------------------------------------------------------------- Phase 1 components */
const RR_PRESETS: Record<SetupType, { t1: number; t2: number }> = {
  BREAKOUT:     { t1: 1.5, t2: 3.0 },
  PULLBACK:     { t1: 1.5, t2: 2.5 },
  EXTENDED:     { t1: 1.0, t2: 2.0 },
  DISTRIBUTION: { t1: 0.7, t2: 1.5 },
  TIGHTENING:   { t1: 1.5, t2: 2.5 },
  UPTREND:      { t1: 1.5, t2: 2.8 },
};

function getRRForSetup(setupType: SetupType, override?: { t1: number; t2: number } | null): { t1: number; t2: number } {
  if (override && override.t1 > 0 && override.t2 > 0) return override;
  return RR_PRESETS[setupType] ?? RR_PRESETS.UPTREND;
}

const SETUP_META: Record<SetupType, { emoji: string; label: string; cls: string }> = {
  BREAKOUT:     { emoji: "🟢", label: "Breakout",     cls: "pastel-positive" },
  PULLBACK:     { emoji: "🔵", label: "Pullback",     cls: "pastel-info" },
  TIGHTENING:   { emoji: "🟡", label: "Tightening",   cls: "pastel-warning" },
  EXTENDED:     { emoji: "🟠", label: "Extended",     cls: "pastel-peach" },
  DISTRIBUTION: { emoji: "🔴", label: "Distribution", cls: "pastel-negative" },
  UPTREND:      { emoji: "⚪", label: "Uptrend",      cls: "bg-muted text-muted-foreground" },
};

function SetupBadge({ type, grade }: { type: SetupType; grade?: SetupGrade }) {
  const m = SETUP_META[type] ?? SETUP_META.UPTREND;
  const gradeCls = grade === "A+" ? "pastel-positive"
    : grade === "A" ? "pastel-info"
    : grade === "B" ? "pastel-warning"
    : "bg-muted text-muted-foreground";
  return (
    <div className="flex items-center gap-1">
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${m.cls}`}>
        <span className="text-[9px]">{m.emoji}</span>{m.label}
      </span>
      {grade && (
        <span className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold tabular-nums ${gradeCls}`}>{grade}</span>
      )}
    </div>
  );
}

function SignalScoreBadge({ score }: { score: number }) {
  if (isNaN(score)) return <span className="text-muted-foreground">—</span>;
  const cls = score >= 80 ? "pastel-positive"
    : score >= 65 ? "pastel-info"
    : score >= 50 ? "pastel-warning"
    : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${cls}`}>{score.toFixed(0)}</span>;
}

function VolMultBadge({ mult, tag }: { mult: number; tag?: "ACCUM" | "DIST" | "NEUTRAL" }) {
  if (isNaN(mult)) return <span className="text-muted-foreground">—</span>;
  const tagCls = tag === "ACCUM" ? "pastel-positive" : tag === "DIST" ? "pastel-negative" : "bg-muted text-muted-foreground";
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-[10px] font-semibold tabular-nums">{mult.toFixed(1)}×</span>
      {tag && <span className={`inline-flex items-center px-1 py-0 rounded text-[8px] font-bold ${tagCls}`}>{tag}</span>}
    </div>
  );
}

function tradePlanRationale(s: ScreenedStock): string {
  const parts: string[] = [];
  switch (s.setupType) {
    case "BREAKOUT":
      parts.push(`Price broke above the 20-day high on ${s.volMult.toFixed(1)}× average volume — institutional accumulation likely.`);
      break;
    case "PULLBACK":
      parts.push(`Uptrend intact (price > 50DMA > 200DMA) with a healthy pullback to the 20DMA. RSI ${s.rsi14.toFixed(0)} is in the buy zone (40–60).`);
      break;
    case "TIGHTENING":
      parts.push(`Bollinger Band width is in the bottom ${s.bbWidth6mPct.toFixed(0)}% of its 6-month range — volatility contraction often precedes expansion.`);
      break;
    case "EXTENDED":
      parts.push(`RSI ${s.rsi14.toFixed(0)} or % above 20DMA (${s.pctAbove20dma.toFixed(1)}%) signals overbought conditions. Wait for pullback.`);
      break;
    case "DISTRIBUTION":
      parts.push(`Heavy volume on a down bar with RSI ${s.rsi14.toFixed(0)} — distribution pattern. Avoid new entries; existing holders should tighten stops.`);
      break;
    case "UPTREND":
    default:
      parts.push(`Steady uptrend with price above key moving averages. Trend-following entry on dips.`);
      break;
  }
  if (s.vsaTag === "ACCUM") parts.push("VSA: accumulation volume today.");
  if (s.vsaTag === "DIST") parts.push("VSA: distribution volume today.");
  return parts.join(" ");
}

function TradePlanSettings({ override, setOverride }: { override: { t1: number; t2: number } | null; setOverride: (v: { t1: number; t2: number } | null) => void }) {
  const isOverride = override !== null;
  const t1 = override?.t1 ?? 1.5;
  const t2 = override?.t2 ?? 2.5;
  // Expectancy blend (assumes 50% T1 hit, 30% T2 hit, 20% stopped) — rough teaching heuristic
  const blended = (0.5 * t1 + 0.3 * t2 - 0.2 * 1).toFixed(2);
  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold flex items-center gap-1.5">
          <SlidersHorizontal className="w-3 h-3" /> R:R Settings
        </Label>
        <Button
          variant={isOverride ? "default" : "outline"}
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => setOverride(isOverride ? null : { t1: 1.5, t2: 2.5 })}
        >
          {isOverride ? "✓ Override globally" : "Override globally"}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-[10px] text-muted-foreground">Target 1 (R)</Label>
            <span className="text-[10px] font-bold tabular-nums text-primary">{t1.toFixed(1)}R</span>
          </div>
          <input
            type="range" min={0.5} max={3.0} step={0.1}
            value={t1}
            disabled={!isOverride}
            onChange={(e) => setOverride({ t1: Number(e.target.value), t2 })}
            className="w-full accent-primary disabled:opacity-40"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-[10px] text-muted-foreground">Target 2 (R)</Label>
            <span className="text-[10px] font-bold tabular-nums text-primary">{t2.toFixed(1)}R</span>
          </div>
          <input
            type="range" min={1.0} max={5.0} step={0.1}
            value={t2}
            disabled={!isOverride}
            onChange={(e) => setOverride({ t1, t2: Number(e.target.value) })}
            className="w-full accent-primary disabled:opacity-40"
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">
          {isOverride ? "Applying to all setups" : "Using per-setup presets (Breakout 1.5/3.0, Pullback 1.5/2.5, …)"}
        </span>
        <span className="font-semibold text-foreground">Blended expectancy: <span className="text-primary tabular-nums">{blended}R</span></span>
      </div>
      {isOverride && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] w-full" onClick={() => setOverride(null)}>
          Reset to per-setup presets
        </Button>
      )}
    </div>
  );
}

function TradePlanField({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" | "warn" | "info" | "default" }) {
  const toneCls = tone === "pos" ? "text-emerald-700 dark:text-emerald-400"
    : tone === "neg" ? "text-red-700 dark:text-red-400"
    : tone === "warn" ? "text-amber-700 dark:text-amber-400"
    : tone === "info" ? "text-blue-700 dark:text-blue-400"
    : "text-foreground";
  return (
    <div className="rounded-md bg-background/60 border border-border/40 p-2">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-[11px] font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

function TradePlanCard({ stocks, regime, rrOverride, setRrOverride }: { stocks: ScreenedStock[]; regime: RegimeState | null; rrOverride: { t1: number; t2: number } | null; setRrOverride: ((v: { t1: number; t2: number } | null) => void) | null }) {
  if (stocks.length === 0) return null;
  const sizeMult = regime?.sizeMultiplier ?? 1;
  const defaultRiskPerTrade = 1000; // ₹1000 risk per trade for illustration
  return (
    <Card className="card-pastel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="w-4 h-4 text-primary" /> Trade Plans — Top {stocks.length} Setups
        </CardTitle>
        <CardDescription>
          Full entry / add / stop / target1 / target2 plan with regime-adjusted position sizing
          {regime && <> · Regime size multiplier: <b className="text-foreground">{(sizeMult * 100).toFixed(0)}%</b></>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {setRrOverride && <TradePlanSettings override={rrOverride} setOverride={setRrOverride} />}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {stocks.map((s) => {
            const rr = getRRForSetup(s.setupType, rrOverride);
            const riskPerShare = s.entryPrice - s.stopPrice;
            const t1 = s.entryPrice + Math.max(0, riskPerShare) * rr.t1;
            const t2 = s.entryPrice + Math.max(0, riskPerShare) * rr.t2;
            const rrRatio = riskPerShare > 0 ? (t2 - s.entryPrice) / riskPerShare : 0;
            const posSize = sizeMult > 0 ? Math.round((defaultRiskPerTrade * sizeMult) / Math.max(0.01, Math.abs(riskPerShare))) : 0;
            const riskRupees = posSize * Math.abs(riskPerShare);
            const t2Gain = posSize * (t2 - s.entryPrice);
            return (
              <div key={s.symbol} className="rounded-lg border border-border/60 bg-card/60 p-3 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{s.symbol}</span>
                      <SetupBadge type={s.setupType} grade={s.setupGrade} />
                    </div>
                    <div className="text-[10px] text-muted-foreground line-clamp-1 max-w-[180px]">{s.longName}</div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-[9px] text-muted-foreground">Signal</span>
                    <SignalScoreBadge score={s.signalScore} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <TradePlanField label="Entry" value={`₹${fmt(s.entryPrice)}`} tone="info" />
                  <TradePlanField label="Add @20DMA" value={`₹${fmt(s.addPrice)}`} tone="default" />
                  <TradePlanField label="Stop" value={`₹${fmt(s.stopPrice)}`} tone="neg" />
                  <TradePlanField label="Target 1" value={`₹${fmt(t1)}`} tone="pos" />
                  <TradePlanField label="Target 2" value={`₹${fmt(t2)}`} tone="pos" />
                  <TradePlanField label="R:R (T2)" value={rrRatio.toFixed(1) + ":1"} tone="info" />
                  <TradePlanField label="Pos. Size" value={`${posSize} sh`} tone="default" />
                  <TradePlanField label="Risk ₹" value={fmtINR(riskRupees)} tone="warn" />
                  <TradePlanField label="T2 Gain ₹" value={fmtINR(t2Gain)} tone="pos" />
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{tradePlanRationale(s)}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RegimeBanner({ regime, loading, error, onRefresh }: { regime: RegimeState | null; loading: boolean; error: string | null; onRefresh: () => void }) {
  // Limited-data state: niftyClose === 0
  if (!regime || regime.niftyClose === 0) {
    return (
      <Card className="border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20">
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              CHOP · 50% size <span className="text-[10px] font-normal opacity-80">(limited data)</span>
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-300/80 mt-0.5">
              {error ? error : "Could not fetch NIFTY data — defaulting to defensive posture. Will auto-retry every 30s."}
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1 border-amber-300 text-amber-700 dark:text-amber-300" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }
  const r = regime;
  const cls = r.regime === "RISK-ON" ? "border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/20"
    : r.regime === "RISK-OFF" ? "border-red-300/60 bg-red-50/60 dark:bg-red-950/20"
    : r.regime === "TRANSITION" ? "border-purple-300/60 bg-purple-50/60 dark:bg-purple-950/20"
    : "border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20";
  const iconCls = r.regime === "RISK-ON" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    : r.regime === "RISK-OFF" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
    : r.regime === "TRANSITION" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
    : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  const Icon = r.regime === "RISK-ON" ? TrendingUp : r.regime === "RISK-OFF" ? TrendingDown : Activity;
  return (
    <Card className={cls}>
      <CardContent className="p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconCls}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-foreground">{r.regime}</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-background/60 tabular-nums">
                Size: {(r.sizeMultiplier * 100).toFixed(0)}%
              </span>
              {r.flippedSessionsAgo > 0 && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded pastel-purple">
                  Flipped {r.flippedSessionsAgo}d ago {r.previousRegime && `from ${r.previousRegime}`}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{r.description}</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] tabular-nums shrink-0">
            <div className="text-right">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide">NIFTY</div>
              <div className="font-semibold text-foreground">{fmt(r.niftyClose, 0)}</div>
            </div>
            <div className={`font-semibold ${r.niftyChangePct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {r.niftyChangePct >= 0 ? "+" : ""}{r.niftyChangePct.toFixed(2)}%
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Breadth</div>
              <div className="font-semibold text-foreground">{r.breadthPct.toFixed(0)}%</div>
            </div>
            <div className="text-right hidden md:block">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Vol</div>
              <div className="font-semibold text-foreground">{r.volatilityPct.toFixed(1)}%</div>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1 shrink-0" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          <b className="text-foreground">Recommendation:</b> {r.recommendation} · As of {fmtISTDateTime(r.asOf)}
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md bg-muted/40 border border-border/40 p-2">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-sm font-bold tabular-nums text-foreground">{value}</div>
      {hint && <div className="text-[9px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function ReturnRow({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <ReturnCell pct={pct} />
    </div>
  );
}

function SetupExplanation({ s }: { s: ScreenedStock }) {
  const reasons: Array<{ ok: boolean; text: string }> = [];
  const isUptrend = s.currentPrice > s.dma50 && s.dma50 > s.dma200;
  reasons.push({ ok: isUptrend, text: `Price > 50DMA > 200DMA (uptrend): ${isUptrend ? "YES" : "NO"}` });
  reasons.push({ ok: s.rsi14 > 50 && s.rsi14 < 75, text: `RSI(14) ${s.rsi14.toFixed(1)} — healthy zone 50-75` });
  reasons.push({ ok: s.pctAbove200dma > 0, text: `${s.pctAbove200dma.toFixed(1)}% above 200DMA` });
  reasons.push({ ok: s.pctAbove20dma >= -2 && s.pctAbove20dma <= 8, text: `${s.pctAbove20dma.toFixed(1)}% above 20DMA — sweet spot for entry (-2 to +8)` });
  reasons.push({ ok: s.volMult >= 1.0, text: `Latest volume ${s.volMult.toFixed(2)}× 50-day average` });
  reasons.push({ ok: s.vsaTag === "ACCUM", text: `VSA tag: ${s.vsaTag}${s.vsaTag === "ACCUM" ? " (bullish)" : s.vsaTag === "DIST" ? " (bearish)" : ""}` });
  reasons.push({ ok: s.bollingerWidth > 0, text: `Bollinger width: ${s.bollingerWidth.toFixed(2)}% (${s.bbWidth6mPct.toFixed(0)}% percentile vs 6M)` });

  return (
    <Card className="card-pastel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="w-4 h-4 text-primary" /> Why this setup?
        </CardTitle>
        <CardDescription>Signal Score: {s.signalScore}/100 · Grade: {s.setupGrade}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md bg-muted/40 border border-border/40 p-2.5 mb-3">
          <p className="text-[11px] text-foreground leading-relaxed">{tradePlanRationale(s)}</p>
        </div>
        <div className="space-y-1.5">
          {reasons.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold ${r.ok ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
                {r.ok ? "✓" : "!"}
              </span>
              <span className="text-muted-foreground">{r.text}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyzeResultCard({ data, regime, rrOverride, setRrOverride }: { data: ScreenedStock; regime: RegimeState | null; rrOverride: { t1: number; t2: number } | null; setRrOverride: (v: { t1: number; t2: number } | null) => void }) {
  const sizeMult = regime?.sizeMultiplier ?? 1;
  const rr = getRRForSetup(data.setupType, rrOverride);
  const riskPerShare = data.entryPrice - data.stopPrice;
  const t1 = data.entryPrice + Math.max(0, riskPerShare) * rr.t1;
  const t2 = data.entryPrice + Math.max(0, riskPerShare) * rr.t2;
  const rrRatio = riskPerShare > 0 ? (t2 - data.entryPrice) / riskPerShare : 0;
  const defaultRiskPerTrade = 1000;
  const posSize = sizeMult > 0 ? Math.round((defaultRiskPerTrade * sizeMult) / Math.max(0.01, Math.abs(riskPerShare))) : 0;
  const riskRupees = posSize * Math.abs(riskPerShare);
  const t2Gain = posSize * (t2 - data.entryPrice);

  return (
    <div className="space-y-4">
      {/* Header card: symbol + setup + signal + price */}
      <Card className="card-pastel">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-foreground">{data.symbol}</h2>
                <SetupBadge type={data.setupType} grade={data.setupGrade} />
                <SignalScoreBadge score={data.signalScore} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{data.longName} · {data.sector}</p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-bold tabular-nums text-foreground">₹{fmt(data.currentPrice)}</div>
              <div className="text-[11px] text-muted-foreground">as of {data.lastDate}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trade Plan with settings */}
      <Card className="card-pastel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="w-4 h-4 text-primary" /> Trade Plan
          </CardTitle>
          <CardDescription>
            Regime size multiplier: <b className="text-foreground">{(sizeMult * 100).toFixed(0)}%</b>
            {regime && <> ({regime.regime})</>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TradePlanSettings override={rrOverride} setOverride={setRrOverride} />
          <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
            <TradePlanField label="Entry" value={`₹${fmt(data.entryPrice)}`} tone="info" />
            <TradePlanField label="Add @20DMA" value={`₹${fmt(data.addPrice)}`} tone="default" />
            <TradePlanField label="Stop" value={`₹${fmt(data.stopPrice)}`} tone="neg" />
            <TradePlanField label="Target 1" value={`₹${fmt(t1)}`} tone="pos" />
            <TradePlanField label="Target 2" value={`₹${fmt(t2)}`} tone="pos" />
            <TradePlanField label="R:R (T2)" value={rrRatio.toFixed(1) + ":1"} tone="info" />
            <TradePlanField label="Pos. Size" value={`${posSize} sh`} tone="default" />
            <TradePlanField label="Risk ₹" value={fmtINR(riskRupees)} tone="warn" />
            <TradePlanField label="T2 Gain ₹" value={fmtINR(t2Gain)} tone="pos" />
          </div>
        </CardContent>
      </Card>

      {/* Technicals grid */}
      <Card className="card-pastel">
        <CardHeader>
          <CardTitle className="text-base">Technicals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric label="RSI(14)" value={data.rsi14.toFixed(1)} hint={data.rsi14 > 70 ? "overbought" : data.rsi14 < 30 ? "oversold" : "neutral"} />
            <Metric label="20DMA" value={`₹${fmt(data.dma20)}`} hint={`${data.pctAbove20dma.toFixed(1)}% above`} />
            <Metric label="50DMA" value={`₹${fmt(data.dma50)}`} hint={data.currentPrice > data.dma50 ? "above" : "below"} />
            <Metric label="200DMA" value={`₹${fmt(data.dma200)}`} hint={`${data.pctAbove200dma.toFixed(1)}% above`} />
            <Metric label="Vol mult" value={`${data.volMult.toFixed(2)}×`} hint={data.vsaTag} />
            <Metric label="BB width" value={`${data.bollingerWidth.toFixed(2)}%`} hint={`${data.bbWidth6mPct.toFixed(0)}% pct`} />
            <Metric label="52W high" value={`₹${fmt(data.high52w)}`} hint={`${data.pctBelowHigh.toFixed(1)}% off`} />
            <Metric label="Sharpe" value={fmt(data.sharpe)} hint="annualized" />
          </div>
        </CardContent>
      </Card>

      {/* Returns grid */}
      <Card className="card-pastel">
        <CardHeader>
          <CardTitle className="text-base">Returns</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ReturnRow label="1 Week" pct={data.ret1wPct} />
            <ReturnRow label="1 Month" pct={data.ret1mPct} />
            <ReturnRow label="3 Months" pct={data.ret3mPct} />
            <ReturnRow label="6 Months" pct={data.ret6mPct} />
          </div>
        </CardContent>
      </Card>

      {/* Why this setup? */}
      <SetupExplanation s={data} />

      {/* Pullback Bridge — multi-timeframe entry framework */}
      <PullbackBridgeCard data={data} />
    </div>
  );
}

/* ---------------------------------------------------------------- PullbackBridgeCard */
function PullbackBridgeCard({ data }: { data: any }) {
  const pb = data.pullbackBridge;
  if (!pb || pb.error) return null;

  const macroPass = pb.macro_filter_pass;
  const monthlyRsi = pb.monthly_rsi ?? 0;
  const tactics = pb.entry_tactics || [];
  const currentPrice = data.currentPrice;

  const statusStyles: Record<string, string> = {
    READY: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
    WAIT: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    TRIGGERED: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    PENDING: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  };

  return (
    <Card className="card-pastel border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="w-4 h-4 text-primary" />
          Pullback Bridge
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">
            Multi-timeframe entry framework
          </span>
        </CardTitle>
        <CardDescription className="text-[10px]">
          Monthly chart as directional filter → Daily/Weekly for safer entry → Don't chase tops
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Macro Filter — Monthly RSI */}
        <div className={`rounded-lg border p-3 ${macroPass ? "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/30" : "border-amber-200 bg-amber-50/50 dark:bg-amber-950/30"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold flex items-center gap-2">
                <span className={macroPass ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                  {macroPass ? "✓" : "⚠"} Macro Filter
                </span>
                <span className="text-[10px] text-muted-foreground">Monthly RSI 60–72</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {macroPass
                  ? "Multi-month institutional momentum confirmed — safe to look for entries"
                  : monthlyRsi > 72
                    ? `Monthly RSI ${monthlyRsi.toFixed(1)} — overbought, wait for cooldown`
                    : monthlyRsi < 60
                      ? `Monthly RSI ${monthlyRsi.toFixed(1)} — below 60, momentum not strong enough`
                      : `Monthly RSI ${monthlyRsi.toFixed(1)} — outside ideal zone`}
              </div>
            </div>
            <div className="text-right">
              <div className={`text-lg font-bold tabular-nums ${macroPass ? "text-emerald-600" : "text-amber-600"}`}>
                {monthlyRsi.toFixed(1)}
              </div>
              <div className="text-[9px] text-muted-foreground">Monthly RSI</div>
            </div>
          </div>
        </div>

        {/* Multi-timeframe levels */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg border border-border/60 bg-card/60 p-2">
            <div className="text-[10px] text-muted-foreground">Daily 20 EMA</div>
            <div className="font-semibold tabular-nums">₹{fmt(pb.daily_20ema)}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5">
              {currentPrice > pb.daily_20ema ? `${((currentPrice / pb.daily_20ema - 1) * 100).toFixed(1)}% above` : `${((1 - currentPrice / pb.daily_20ema) * 100).toFixed(1)}% below`}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-card/60 p-2">
            <div className="text-[10px] text-muted-foreground">Weekly 9 EMA</div>
            <div className="font-semibold tabular-nums">₹{fmt(pb.weekly_9ema)}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5">
              {currentPrice > pb.weekly_9ema ? `${((currentPrice / pb.weekly_9ema - 1) * 100).toFixed(1)}% above` : `${((1 - currentPrice / pb.weekly_9ema) * 100).toFixed(1)}% below`}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-card/60 p-2">
            <div className="text-[10px] text-muted-foreground">Swing Low (10d)</div>
            <div className="font-semibold tabular-nums text-red-600">₹{fmt(pb.swing_low)}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5">Stop reference</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-card/60 p-2">
            <div className="text-[10px] text-muted-foreground">Prev Week Low</div>
            <div className="font-semibold tabular-nums text-red-600">₹{fmt(pb.prev_week_low)}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5">30-day emergency stop</div>
          </div>
        </div>

        {/* 3 Entry Tactics */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">3 Entry Tactics (Mid-Month Access)</div>
          {tactics.map((t: any, i: number) => (
            <div key={t.id} className="rounded-lg border border-border/60 bg-card/60 p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-muted-foreground">#{i + 1}</span>
                    <span className="text-sm font-semibold">{t.name}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold ${statusStyles[t.status] || statusStyles.PENDING}`}>
                      {t.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground italic mt-0.5">{t.subtitle}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">{t.description}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-[9px] text-muted-foreground">Entry</div>
                  <div className="font-bold tabular-nums text-emerald-600">₹{fmt(t.entry)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Stop</div>
                  <div className="font-bold tabular-nums text-red-600">₹{fmt(t.stop)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Risk</div>
                  <div className={`font-bold tabular-nums ${t.risk_pct > 8 ? "text-red-600" : t.risk_pct > 5 ? "text-amber-600" : "text-emerald-600"}`}>
                    {t.risk_pct.toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Anchor Candle details */}
        {pb.anchor_candle && (
          <div className="rounded-lg border border-blue-200/50 bg-blue-50/30 dark:bg-blue-950/20 p-2 text-[10px]">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-blue-700 dark:text-blue-300">📌 Anchor Candle</span>
              <span className="text-muted-foreground">{pb.anchor_candle.date}</span>
            </div>
            <div className="text-muted-foreground mt-0.5">
              Highest-volume green candle this month: H=₹{fmt(pb.anchor_candle.high)} · Vol={Number(pb.anchor_candle.volume).toLocaleString("en-IN")} · Break above ₹{fmt(pb.anchor_break_price)}
            </div>
          </div>
        )}

        {/* Monthly Range */}
        {pb.month_range_high && pb.month_range_low && (
          <div className="rounded-lg border border-border/60 bg-card/60 p-2 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="font-semibold">This Month's Range</span>
              <span className="text-muted-foreground">₹{fmt(pb.month_range_low)} — ₹{fmt(pb.month_range_high)}</span>
            </div>
            {/* Visual range bar */}
            <div className="mt-2 relative h-6 bg-muted/40 rounded">
              <div className="absolute inset-0 flex items-center justify-between px-2 text-[9px] tabular-nums">
                <span className="text-red-600">L ₹{fmt(pb.month_range_low)}</span>
                <span className="text-emerald-600">H ₹{fmt(pb.month_range_high)}</span>
              </div>
              {/* 50% marker */}
              {pb.month_range_50pct && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-amber-500" style={{ left: "50%" }}>
                  <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-amber-600 whitespace-nowrap">
                    50% ₹{fmt(pb.month_range_50pct)}
                  </div>
                </div>
              )}
              {/* Current price marker */}
              {(() => {
                const range = pb.month_range_high - pb.month_range_low;
                if (range <= 0) return null;
                const pct = ((currentPrice - pb.month_range_low) / range) * 100;
                const clampedPct = Math.max(0, Math.min(100, pct));
                return (
                  <div className="absolute top-0 bottom-0 w-1 bg-primary rounded" style={{ left: `${clampedPct}%` }} title={`Current: ₹${fmt(currentPrice)}`} />
                );
              })()}
            </div>
          </div>
        )}

        {/* Modified Exit Rule */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 dark:bg-amber-950/20 p-3">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">Modified Exit Rule (Mid-Month Entry)</span>
          </div>
          <div className="text-[10px] text-amber-700 dark:text-amber-300 space-y-1">
            <div><b>First 30 days:</b> Use previous week's low (₹{fmt(pb.prev_week_low)}) as emergency stop. Don't wait for monthly close — that could mean 25%+ loss.</div>
            <div><b>After 30 days + in profit:</b> Switch to monthly 20 EMA trailing exit (original strategy rule).</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyzePanel({ input, setInput, onAnalyze, symbol, data, loading, error, regime, suggestions, rrOverride, setRrOverride }: {
  input: string;
  setInput: (v: string) => void;
  onAnalyze: (symbol: string) => void;
  symbol: string;
  data: ScreenedStock | null;
  loading: boolean;
  error: string | null;
  regime: RegimeState | null;
  suggestions: string[];
  rrOverride: { t1: number; t2: number } | null;
  setRrOverride: (v: { t1: number; t2: number } | null) => void;
}) {
  const QUICK_PICKS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "TATAMOTORS", "TATASTEEL", "ADANIENT"];
  return (
    <div className="space-y-4">
      <Card className="card-pastel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="w-4 h-4 text-primary" /> Analyze Any NSE Stock
          </CardTitle>
          <CardDescription>
            Enter a symbol to fetch the full trade plan: setup type, signal score, entry/add/stop/target1/target2, R:R, and rationale.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="e.g. RELIANCE, TCS, INFY"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && input.trim()) onAnalyze(input.trim());
              }}
              className="text-sm"
            />
            <Button onClick={() => input.trim() && onAnalyze(input.trim())} disabled={loading || !input.trim()}>
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span className="hidden sm:inline ml-1.5">{loading ? "Analyzing…" : "Analyze"}</span>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground mr-1">Quick pick:</span>
            {QUICK_PICKS.map((sym) => (
              <button
                key={sym}
                onClick={() => onAnalyze(sym)}
                className="px-2 py-0.5 rounded-md text-[10px] font-medium border border-border/60 bg-background hover:bg-muted text-foreground transition-colors"
              >
                {sym}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="card-pastel border-red-300/60 bg-red-50/40 dark:bg-red-950/20">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-red-900 dark:text-red-200">Analysis failed for {symbol || "symbol"}</p>
                <p className="text-xs text-red-700 dark:text-red-300 mt-1">{error}</p>
                {suggestions.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] text-red-700 dark:text-red-300 font-medium mb-1.5">Did you mean?</p>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map((sug) => (
                        <button
                          key={sug}
                          onClick={() => onAnalyze(sug)}
                          className="px-2 py-0.5 rounded-md text-[10px] font-medium border border-red-200 bg-white dark:bg-card hover:bg-red-50 dark:hover:bg-red-900/30 text-red-800 dark:text-red-200 transition-colors"
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card className="card-pastel">
          <CardContent className="p-8 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm font-medium text-foreground">Analyzing {symbol}…</p>
            <p className="text-xs text-muted-foreground">Downloading 1y OHLCV, computing indicators, classifying setup, building trade plan.</p>
          </CardContent>
        </Card>
      )}

      {data && !loading && !error && (
        <AnalyzeResultCard data={data} regime={regime} rrOverride={rrOverride} setRrOverride={setRrOverride} />
      )}

      {!data && !loading && !error && (
        <Card className="card-pastel border-dashed">
          <CardContent className="p-8 text-center">
            <Search className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Enter a symbol above to see the full trade plan.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- BridgeTradePlanCard */
function BridgeTradePlanCard({ stocks, regime }: { stocks: any[]; regime: RegimeState | null }) {
  if (!stocks || stocks.length === 0) return null;
  const mult = regime?.sizeMultiplier ?? 1.0;
  const baseCapital = 100000;
  const adjCapital = Math.round(baseCapital * mult);

  return (
    <Card className="card-pastel border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="w-4 h-4 text-primary" />
          Bridge Trade Plans — Top {stocks.length} with Trailing SL
        </CardTitle>
        <CardDescription className="text-[10px]">
          Pullback Bridge entries · Trailing SL = previous week's low (30-day emergency stop) · Position size = ₹{baseCapital.toLocaleString("en-IN")} × {Math.round(mult * 100)}% regime
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {stocks.map((s) => {
            const riskPerShare = s.entryPrice - (s.trailingSL ?? s.stopPrice ?? s.currentPrice * 0.95);
            const posSize = riskPerShare > 0 ? Math.floor(adjCapital / s.entryPrice) : 0;
            const riskRupees = posSize * riskPerShare;
            const tactics = s.allTactics || [];

            return (
              <div key={s.symbol} className="rounded-lg border border-border/60 bg-card/60 p-3">
                {/* Header row */}
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{s.symbol}</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold ${s.macroFilterPass ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"}`}>
                        RSI {s.monthlyRsi?.toFixed(0)}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground line-clamp-1 max-w-[180px]">{s.longName}</div>
                  </div>
                  <SignalScoreBadge score={s.bridgeScore ?? 0} />
                </div>

                {/* Active tactic + entry/stop */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] mb-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tactic</span>
                    <span className="font-semibold text-[10px]">{s.activeTactic}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Entry</span>
                    <span className="font-semibold tabular-nums text-emerald-600">₹{fmt(s.entryPrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Trailing SL</span>
                    <span className="font-semibold tabular-nums text-red-600">₹{fmt(s.trailingSL)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Risk</span>
                    <span className={`font-semibold tabular-nums ${s.riskPct < 5 ? "text-emerald-600" : s.riskPct < 8 ? "text-amber-600" : "text-red-600"}`}>
                      {s.riskPct?.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* All 3 tactics mini-badges */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {tactics.map((t: any) => (
                    <span key={t.id} className={`inline-flex items-center px-1 py-0.5 rounded text-[8px] font-medium ${
                      t.status === "READY" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                      : t.status === "TRIGGERED" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                      : "bg-muted text-muted-foreground"
                    }`} title={`${t.name}: Entry ₹${t.entry?.toFixed(0)}, Stop ₹${t.stop?.toFixed(0)}, Risk ${t.risk_pct?.toFixed(1)}%`}>
                      {t.status === "READY" ? "✓" : t.status === "TRIGGERED" ? "●" : "○"} {t.id === "ema_touchdown" ? "20EMA" : t.id === "anchor_break" ? "Anchor" : "50%"}
                    </span>
                  ))}
                </div>

                {/* Position size footer */}
                <div className="pt-2 border-t border-border/40 grid grid-cols-3 gap-2 text-[10px]">
                  <div>
                    <div className="text-muted-foreground">Size</div>
                    <div className="font-semibold tabular-nums">{posSize} sh</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Risk ₹</div>
                    <div className="font-semibold tabular-nums text-red-600">₹{Math.round(riskRupees).toLocaleString("en-IN")}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Daily 20EMA</div>
                    <div className="font-semibold tabular-nums">₹{fmt(s.daily20ema)}</div>
                  </div>
                </div>

                {/* Modified exit rule reminder */}
                <div className="mt-2 text-[9px] text-amber-600 italic">
                  ⚠ First 30 days: SL = prev week low (₹{fmt(s.prevWeekLow)}). After 30d + profit: switch to monthly 20 EMA trailing.
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- ScreenPanel */
function ScreenPanel({ screen, running, topN, filters, elapsedMs, prevScreenSymbols, changeHistory, onClearHistory, regime, onAnalyze, rrOverride, setRrOverride, screenMode }: { screen: ScreenResponse | null; running: boolean; topN: number; filters: { rsiMin: number; mcapMin: number; volMin: number }; elapsedMs?: number; prevScreenSymbols?: string[] | null; changeHistory?: ScreenChange[]; onClearHistory?: () => void; regime?: RegimeState | null; onAnalyze?: (symbol: string) => void; rrOverride?: { t1: number; t2: number } | null; setRrOverride?: (v: { t1: number; t2: number } | null) => void; screenMode?: "momentum" | "bridge" }) {
  if (running && (!screen || elapsedMs > 1000)) {
    const elapsed = elapsedMs ? (elapsedMs / 1000).toFixed(1) : "0.0";
    const isBridge = screenMode === "bridge";
    const estTotal = isBridge ? 20 : 30; // bridge now takes ~17s (top 250 + 18mo), momentum ~30s
    const pct = Math.min(95, (elapsedMs || 0) / (estTotal * 10));
    return (
      <Card className="card-pastel">
        <CardContent className="p-8">
          <div className="flex flex-col items-center justify-center text-center space-y-4">
            <div className="relative">
              <RefreshCw className="w-12 h-12 text-primary animate-spin" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {isBridge ? "Running Pullback Bridge Screener…" : "Fetching live market data…"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {isBridge
                  ? "Downloading 18 months of data for top 250 NSE stocks (by market cap), computing Monthly RSI + Daily 20 EMA + Anchor Candle + 50% Retracement. Takes ~17 seconds."
                  : "Downloading 18 months of OHLCV for ~350 NSE stocks, computing RSI/MA/returns, then fetching market cap + sector for qualifiers."}
              </p>
            </div>
            <div className="w-full max-w-md space-y-2">
              <Progress value={pct} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{elapsed}s elapsed</span>
                <span>est. {isBridge ? "15-20s" : "25-30s"} total</span>
              </div>
            </div>
            {isBridge && (
              <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-md p-2 max-w-md">
                Scanning top 250 stocks by market cap · 18 months of data for Monthly RSI
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 w-full max-w-md text-xs">
              <div className="pastel-info rounded-md p-2 text-center">
                <div className="font-bold tabular-nums">1</div>
                <div className="text-[10px] opacity-80">{isBridge ? "Download 2Y" : "Download OHLCV"}</div>
              </div>
              <div className="pastel-warning rounded-md p-2 text-center">
                <div className="font-bold tabular-nums">2</div>
                <div className="text-[10px] opacity-80">{isBridge ? "Monthly RSI + EMAs" : "Compute indicators"}</div>
              </div>
              <div className="pastel-purple rounded-md p-2 text-center">
                <div className="font-bold tabular-nums">3</div>
                <div className="text-[10px] opacity-80">Fetch market cap</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!screen) {
    const isBridge = screenMode === "bridge";
    return (
      <Card className="card-pastel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            {isBridge ? "Pullback Bridge Screener — Not yet run" : "Momentum Screen — Not yet run"}
          </CardTitle>
          <CardDescription>
            {isBridge
              ? <>Click <b>Run Bridge</b> to find stocks with Monthly RSI 60–72, trend intact, and at least one entry tactic READY.</>
              : <>Click <b>Run Screen</b> at the top to fetch live data for ~350 NSE stocks and apply the 6 momentum rules.</>
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground dark:text-muted-foreground/50">
              {isBridge ? "Bridge screening rules:" : "Screening rules:"}
            </p>
            {isBridge ? (
              <ul className="list-disc pl-5 space-y-1">
                <li>Monthly RSI between 55–75 (macro filter — multi-month momentum active)</li>
                <li>Price &gt; 50 DMA &gt; 200 DMA (trend intact)</li>
                <li>At least one entry tactic READY or TRIGGERED:
                  <ul className="list-circle pl-4 mt-1 text-xs">
                    <li>Daily 20 EMA Touchdown</li>
                    <li>Anchor Candle High Break</li>
                    <li>50% Monthly Range Retracement</li>
                  </ul>
                </li>
                <li>Market Cap &gt; ₹{filters.mcapMin} Cr</li>
                <li><b>Sort</b>: Bridge Score DESC, top {topN}</li>
                <li>Each stock comes with a <b>trailing stop-loss</b> (previous week's low)</li>
              </ul>
            ) : (
              <ul className="list-disc pl-5 space-y-1">
                <li>Current Price &gt; 200 DMA</li>
                <li>Current Price &gt; 50 DMA</li>
                <li>50 DMA &gt; 200 DMA</li>
                <li>RSI(14) &gt; {filters.rsiMin}</li>
                <li>Market Cap &gt; ₹{filters.mcapMin} Cr</li>
                <li>30-day Avg Volume &gt; {filters.volMin.toLocaleString("en-IN")}</li>
                <li><b>Sort</b>: Signal Score DESC, top {topN}</li>
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {/* Error/warning banner — Yahoo rate-limited or showing stale/fallback data */}
      {(screen.error || screen.warning) && (
        <Card className={`card-pastel ${screen.error ? "border-red-300/60 bg-red-50/50" : "border-amber-300/60 bg-amber-50/50"}`}>
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${screen.error ? "text-red-600" : "text-amber-600"}`} />
            <div className="flex-1">
              <p className={`text-sm font-medium ${screen.error ? "text-red-900" : "text-amber-900"}`}>
                {screen.error
                  ? "Yahoo Finance rate-limited"
                  : screen.fallback
                    ? "Showing fallback data"
                    : screen.stale
                      ? "Showing cached data"
                      : "Notice"}
              </p>
              <p className={`text-xs mt-1 ${screen.error ? "text-red-700" : "text-amber-700"}`}>
                {screen.error || screen.warning}
              </p>
              <p className={`text-xs mt-2 ${screen.error ? "text-red-600" : "text-amber-600"}`}>
                {screen.error
                  ? "The screen will auto-retry. You can also click \"Run Screen\" again in a minute."
                  : "Data below is from an earlier successful fetch. Click \"Run Screen\" to try fetching fresh data."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Activity className="w-4 h-4" />} label="Universe" value={String(screen.universeSize)} sub="NSE stocks" />
        <StatCard icon={<TrendingUp className="w-4 h-4" />} label="With full data" value={String(screen.passedData)} sub="18-month OHLCV" />
        <StatCard icon={<Gauge className="w-4 h-4" />} label="Pass technical" value={String(screen.passedTech)} sub="MA + RSI + Vol" />
        <StatCard icon={<Wallet className="w-4 h-4" />} label="Pass market cap" value={String(screen.passedMc)} sub="> ₹500 Cr" tone="emerald" />
      </div>

      {/* Change History — shows when stocks were added/removed with dates */}
      {changeHistory && changeHistory.length > 0 && (
        <Card className="card-pastel">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="w-4 h-4 text-primary" /> Change History
              </CardTitle>
              <CardDescription className="text-[10px] mt-0.5">
                When stocks entered or left your Top {topN} · persisted across sessions
              </CardDescription>
            </div>
            {onClearHistory && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground" onClick={onClearHistory}>
                Clear
              </Button>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3 max-h-72 overflow-y-auto scroll-pastel">
              {/* Show most recent first */}
              {[...changeHistory].reverse().slice(0, 10).map((change, idx) => {
                const date = new Date(change.date);
                const dateStr = fmtISTDate(change.date);
                const timeStr = fmtISTTime(change.date);
                const isMostRecent = idx === 0;
                return (
                  <div key={change.date} className={`p-3 rounded-lg border ${isMostRecent ? "border-primary/30 bg-primary/5" : "border-border/40"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded ${isMostRecent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                          {dateStr}
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{timeStr}</span>
                        {isMostRecent && <span className="text-[9px] font-semibold text-primary uppercase tracking-wide">Latest</span>}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {change.added.length > 0 || change.removed.length > 0
                          ? `${change.added.length} added · ${change.removed.length} removed`
                          : "No changes"}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {change.added.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[9px] font-semibold text-emerald-600 mr-1">↑</span>
                          {change.added.map((s) => (
                            <span key={s.symbol} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium pastel-positive">
                              {s.symbol}
                              <span className="opacity-60">+{s.ret6mPct.toFixed(0)}%</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {change.removed.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[9px] font-semibold text-red-600 mr-1">↓</span>
                          {change.removed.map((sym) => (
                            <span key={sym} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium pastel-negative line-through opacity-70">
                              {sym}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trade Plan card — top 5 setups (momentum mode only; bridge has its own table) */}
      {screen.top10.length > 0 && onAnalyze && screenMode !== "bridge" && (
        <TradePlanCard stocks={screen.top10.slice(0, 5)} regime={regime ?? null} rrOverride={rrOverride ?? null} setRrOverride={setRrOverride ?? null} />
      )}

      {/* Bridge mode — Trade Plan cards with trailing SL */}
      {screen.top10.length > 0 && screenMode === "bridge" && (
        <BridgeTradePlanCard stocks={screen.top10.slice(0, 5)} regime={regime ?? null} />
      )}

      {/* Top 10 table */}
      <Card className="card-pastel">
        <CardHeader>
          <CardTitle>{screenMode === "bridge" ? `Top ${screen.top10.length} Pullback Bridge Stocks` : `Top ${screen.top10.length} Momentum Stocks`}</CardTitle>
          <CardDescription>
            {screenMode === "bridge"
              ? <>Ranked by Bridge Score · Monthly RSI 55–75 · Entry tactics READY · Trailing SL = prev week low · as of {fmtISTDateTime(screen.runAt)}</>
              : <>Ranked by composite Signal Score (0-100) · Screen took {(screen.elapsedMs / 1000).toFixed(1)}s · as of {fmtISTDateTime(screen.runAt)}</>
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {screen.top10.length === 0 ? (
            <div className="p-6 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
              <div>
                <p className="text-sm font-medium text-foreground">No stocks passed the filters</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This is usually because Yahoo Finance rate-limited the market cap lookup. Try again in 30 seconds.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {screen.passedTech} stocks passed technical filters but market cap data couldn't be fetched for all of them.
              </p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Symbol</TableHead>
                  {screenMode === "bridge" ? (
                    <>
                      <TableHead className="text-right">Monthly RSI</TableHead>
                      <TableHead className="text-right">Bridge</TableHead>
                      <TableHead>Active Tactic</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Trailing SL</TableHead>
                      <TableHead className="text-right">Risk%</TableHead>
                      <TableHead className="text-right">1W %</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">1M %</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">6M %</TableHead>
                      <TableHead className="text-right hidden md:table-cell">Price</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="hidden md:table-cell">Sector</TableHead>
                      <TableHead className="text-right">Price (₹)</TableHead>
                      <TableHead className="text-right">RSI</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">MCap (₹Cr)</TableHead>
                      <TableHead className="text-right">1M %</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">3M %</TableHead>
                      <TableHead className="text-right hidden md:table-cell">6M %</TableHead>
                      <TableHead className="text-right hidden lg:table-cell">Sharpe</TableHead>
                      <TableHead>Setup</TableHead>
                      <TableHead className="text-right">Signal</TableHead>
                      <TableHead className="text-right hidden md:table-cell">R:R</TableHead>
                      <TableHead className="text-right hidden lg:table-cell">Vol</TableHead>
                      <TableHead className="text-right hidden md:table-cell">Mom.</TableHead>
                    </>
                  )}
                  {onAnalyze && <TableHead className="text-right">Analyze</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {screen.top10.map((s: any) => (
                  <TableRow key={s.symbol}>
                    <TableCell className="font-bold text-muted-foreground/70">{s.rank}</TableCell>
                    <TableCell>
                      <div className="font-semibold">{s.symbol}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1 max-w-[160px]">{s.longName}</div>
                    </TableCell>
                    {screenMode === "bridge" ? (
                      <>
                        <TableCell className="text-right">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${s.macroFilterPass ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"}`}>
                            {s.monthlyRsi?.toFixed(1)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <SignalScoreBadge score={s.bridgeScore ?? 0} />
                        </TableCell>
                        <TableCell>
                          <div className="text-[10px] font-semibold leading-tight">{s.activeTactic}</div>
                          <div className="text-[9px] text-muted-foreground">{s.activeTacticId === "anchor_break" ? "Momentum" : s.activeTacticId === "ema_touchdown" ? "Safest" : "Value"}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600 font-semibold">₹{fmt(s.entryPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-600 font-semibold">₹{fmt(s.trailingSL)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`text-[10px] font-bold tabular-nums ${s.riskPct < 5 ? "text-emerald-600" : s.riskPct < 8 ? "text-amber-600" : "text-red-600"}`}>
                            {s.riskPct?.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums"><ReturnCell pct={s.ret1wPct} /></TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell"><ReturnCell pct={s.ret1mPct} /></TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell font-semibold"><ReturnCell pct={s.ret6mPct} /></TableCell>
                        <TableCell className="text-right tabular-nums hidden md:table-cell">₹{fmt(s.currentPrice)}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="hidden md:table-cell text-muted-foreground">{s.sector}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(s.currentPrice)}</TableCell>
                        <TableCell className="text-right">
                          <RsiBadge rsi={s.rsi14} />
                        </TableCell>
                        <TableCell className="text-right hidden sm:table-cell tabular-nums">{fmt(s.marketCapCr, 0)}</TableCell>
                        <TableCell className="text-right tabular-nums"><ReturnCell pct={s.ret1mPct} /></TableCell>
                        <TableCell className="text-right hidden sm:table-cell tabular-nums"><ReturnCell pct={s.ret3mPct} /></TableCell>
                        <TableCell className="text-right hidden md:table-cell tabular-nums font-semibold"><ReturnCell pct={s.ret6mPct} /></TableCell>
                        <TableCell className="text-right hidden lg:table-cell tabular-nums">{fmt(s.sharpe)}</TableCell>
                        <TableCell><SetupBadge type={s.setupType} grade={s.setupGrade} /></TableCell>
                        <TableCell className="text-right"><SignalScoreBadge score={s.signalScore} /></TableCell>
                        <TableCell className="text-right hidden md:table-cell tabular-nums">
                          <span className="text-[10px] font-semibold">{getRRForSetup(s.setupType, rrOverride ?? null).t2.toFixed(1)}:1</span>
                        </TableCell>
                        <TableCell className="text-right hidden lg:table-cell">
                          <VolMultBadge mult={s.volMult} tag={s.vsaTag} />
                        </TableCell>
                        <TableCell className="text-right hidden md:table-cell">
                          <MomentumScoreBadge score={s.momentumScore} />
                        </TableCell>
                      </>
                    )}
                    {onAnalyze && (
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => onAnalyze(s.symbol)}>
                          <Search className="w-3 h-3" /> Analyze
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- AllocationPanel */
function AllocationPanel({
  screen, alloc, totalInvestment, setTotalInvestment, runAllocation, allocDirty, onGoToStops, onGoToStress,
  allocationMode, setAllocationMode,
  rebalance, runRebalance, rebalanceRunning,
}: {
  screen: ScreenResponse | null;
  alloc: AllocateResponse | null;
  totalInvestment: number;
  setTotalInvestment: (n: number) => void;
  runAllocation: () => void;
  allocDirty: boolean;
  onGoToStops: () => void;
  onGoToStress: () => void;
  allocationMode: "risk-parity" | "momentum";
  setAllocationMode: (m: "risk-parity" | "momentum") => void;
  rebalance: RebalanceResult | null;
  runRebalance: () => void;
  rebalanceRunning: boolean;
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
      {/* Investment input + allocation mode toggle */}
      <Card className="card-pastel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" /> Investment Amount</CardTitle>
          <CardDescription>Enter your total capital to allocate across the Top {screen?.top10.length ?? 10} momentum stocks.</CardDescription>
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

          {/* Allocation mode toggle */}
          <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border/40">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-medium text-foreground">Allocation Engine</Label>
              <div className="flex rounded-md bg-background border border-border overflow-hidden">
                <button
                  onClick={() => setAllocationMode("risk-parity")}
                  className={`px-3 py-1 text-[11px] font-medium transition-colors ${allocationMode === "risk-parity" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Risk Parity
                </button>
                <button
                  onClick={() => setAllocationMode("momentum")}
                  className={`px-3 py-1 text-[11px] font-medium transition-colors ${allocationMode === "momentum" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Momentum-weighted
                </button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {allocationMode === "risk-parity"
                ? "Inverse-volatility × RSI penalty · Hard caps: 15% per stock, 25% per sector, 5% floor. Equal risk contribution."
                : "Momentum score² weighting · Soft caps: 25% per stock, 40% per sector, 3% floor. Stronger momentum = larger position."}
            </p>
            {alloc && allocationMode !== alloc.mode && (
              <p className="text-[10px] text-amber-600 mt-1">
                ⚠ Mode changed — click "Recompute" to apply the new engine
              </p>
            )}
          </div>

          {/* Rebalance button — appears when allocation exists */}
          {alloc && (
            <div className="mt-3 p-3 rounded-lg pastel-purple/30 border border-purple-200/40">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">Dynamic Rebalance</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Compare current holdings to fresh screen. Buy more if momentum rose, trim if it fell, exit if it died.
                  </p>
                </div>
                <Button onClick={runRebalance} disabled={rebalanceRunning} size="sm" variant="outline" className="shrink-0">
                  <RefreshCw className={`w-3 h-3 mr-1.5 ${rebalanceRunning ? "animate-spin" : ""}`} />
                  {rebalanceRunning ? "Computing…" : "Run Rebalance"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rebalance results table */}
      {rebalance && (
        <RebalancePanel rebalance={rebalance} />
      )}

      {alloc && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={<Wallet className="w-4 h-4" />} label="Allocated" value={fmtINR(alloc.totalAllocated)} sub={`${fmt(alloc.totalAllocated / alloc.totalInvested * 100, 1)}% of capital`} />
            <StatCard icon={<Activity className="w-4 h-4" />} label="Cash leftover" value={fmtINR(alloc.cashLeftover)} sub="from share rounding" />
            <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Weighted 6M ret" value={fmtPct(alloc.allocation.reduce((a, s) => a + s.weight * s.ret6mPct, 0) / alloc.allocation.reduce((a, s) => a + s.weight, 0))} sub="portfolio momentum" tone="emerald" />
            <StatCard icon={<Gauge className="w-4 h-4" />} label="Weighted vol" value={`${fmt(alloc.allocation.reduce((a, s) => a + s.weight * s.annVolPct, 0))}%`} sub="annualized" tone="amber" />
          </div>

          {/* Removed stocks banner — stocks that couldn't be afforded with allocated rupees */}
          {alloc.removedStocks.length > 0 && (
            <Card className="card-pastel border-amber-300/60 bg-amber-50/40">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-900">
                      {alloc.removedStocks.length} stock{alloc.removedStocks.length > 1 ? "s" : ""} removed — price exceeded allocation
                    </p>
                    <p className="text-xs text-amber-700 mt-1 mb-3">
                      These stocks were too expensive to buy even 1 share with their allocated rupees.
                      Their weight has been redistributed to the remaining {alloc.allocation.length} stocks.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {alloc.removedStocks.map((s) => (
                        <span
                          key={s.symbol}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200"
                          title={s.reason}
                        >
                          {s.symbol}
                          <span className="opacity-70">₹{s.currentPrice.toFixed(0)}</span>
                          <span className="opacity-50">→</span>
                          <span className="opacity-70">₹{s.attemptedRupees.toFixed(0)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Allocation table */}
          <Card className="card-pastel">
            <CardHeader>
              <CardTitle>Allocation Breakdown — {fmtINR(alloc.totalInvested)}</CardTitle>
              <CardDescription>
                Inverse-volatility base × RSI penalty · Max 15% per stock · Max 25% per sector
                {alloc.removedStocks.length > 0 && ` · ${alloc.allocation.length} of ${alloc.allocation.length + alloc.removedStocks.length} stocks affordable`}
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
          <StatCard icon={<Activity className="w-4 h-4" />} label="As of" value={fmtISTTime(stops.runAt)} sub="latest NSE close" />
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

function MomentumScoreBadge({ score }: { score: number }) {
  if (isNaN(score)) return <span className="text-muted-foreground">—</span>;
  const cls = score > 75 ? "pastel-positive" : score > 60 ? "pastel-info" : score > 45 ? "bg-muted text-muted-foreground" : "pastel-warning";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold tabular-nums ${cls}`}>{score.toFixed(0)}</span>;
}

/* ---------------------------------------------------------------- RebalancePanel */
function RebalancePanel({ rebalance }: { rebalance: RebalanceResult }) {
  const s = rebalance.summary;
  const actionColors: Record<RebalanceAction, string> = {
    "BUY MORE": "pastel-positive",
    "HOLD": "bg-muted text-muted-foreground",
    "TRIM 30%": "pastel-warning",
    "TRIM 60%": "pastel-warning",
    "EXIT": "pastel-negative",
    "INITIATE": "pastel-info",
  };

  return (
    <Card className="card-pastel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="w-4 h-4 text-primary" /> Rebalance Actions
        </CardTitle>
        <CardDescription>
          Compare current holdings to fresh screen · momentum-driven buy/trim/exit decisions
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Summary stat cards */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
          <div className="pastel-positive rounded-md p-2 text-center">
            <div className="text-base font-bold tabular-nums">{s.buyMore}</div>
            <div className="text-[9px] opacity-80">Buy More</div>
          </div>
          <div className="bg-muted rounded-md p-2 text-center">
            <div className="text-base font-bold tabular-nums">{s.hold}</div>
            <div className="text-[9px] text-muted-foreground">Hold</div>
          </div>
          <div className="pastel-warning rounded-md p-2 text-center">
            <div className="text-base font-bold tabular-nums">{s.trim30 + s.trim60}</div>
            <div className="text-[9px] opacity-80">Trim</div>
          </div>
          <div className="pastel-negative rounded-md p-2 text-center">
            <div className="text-base font-bold tabular-nums">{s.exit}</div>
            <div className="text-[9px] opacity-80">Exit</div>
          </div>
          <div className="pastel-info rounded-md p-2 text-center">
            <div className="text-base font-bold tabular-nums">{s.initiate}</div>
            <div className="text-[9px] opacity-80">New</div>
          </div>
          <div className="rounded-md p-2 text-center border border-border/60">
            <div className={`text-base font-bold tabular-nums ${s.netCashflow >= 0 ? "text-emerald-600" : "text-amber-600"}`}>
              {s.netCashflow >= 0 ? "+" : "−"}{fmtINR(Math.abs(s.netCashflow))}
            </div>
            <div className="text-[9px] text-muted-foreground">{s.netCashflow >= 0 ? "Cash freed" : "Deploy"}</div>
          </div>
        </div>

        {/* Action table */}
        <div className="overflow-x-auto scroll-pastel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-center">Action</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Entry ₹</TableHead>
                <TableHead className="text-right">Current ₹</TableHead>
                <TableHead className="text-right hidden sm:table-cell">P&L %</TableHead>
                <TableHead className="text-right">Mom. Δ</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead className="text-right">₹ Change</TableHead>
                <TableHead className="hidden lg:table-cell">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rebalance.items.map((item) => (
                <TableRow key={item.symbol}>
                  <TableCell>
                    <div className="font-semibold text-xs">{item.symbol}</div>
                    <div className="text-[9px] text-muted-foreground line-clamp-1 max-w-[120px]">{item.longName}</div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold ${actionColors[item.action]}`}>
                      {item.action}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs hidden sm:table-cell">
                    {item.entryPrice ? fmt(item.entryPrice, 0) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{fmt(item.currentPrice, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs hidden sm:table-cell">
                    {item.pnlPct !== undefined ? <ReturnCell pct={item.pnlPct} /> : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {item.momentumDelta !== undefined ? (
                      <span className={item.momentumDelta > 0 ? "text-emerald-600 font-semibold" : item.momentumDelta < -10 ? "text-red-600 font-semibold" : "text-muted-foreground"}>
                        {item.momentumDelta > 0 ? "+" : ""}{item.momentumDelta.toFixed(0)}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    <div className="flex flex-col items-end">
                      <span className="font-medium">{item.targetShares}</span>
                      {item.currentShares !== undefined && item.sharesChange !== 0 && (
                        <span className={`text-[9px] ${item.sharesChange > 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {item.sharesChange > 0 ? "+" : ""}{item.sharesChange}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    <span className={item.rupeesChange > 0 ? "text-emerald-600 font-medium" : item.rupeesChange < 0 ? "text-red-600 font-medium" : "text-muted-foreground"}>
                      {item.rupeesChange > 0 ? "+" : item.rupeesChange < 0 ? "−" : ""}{fmtINR(Math.abs(item.rupeesChange))}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-[10px] text-muted-foreground max-w-[200px]">
                    {item.reason}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-[10px] text-muted-foreground mt-3">
          <b>Rules:</b> Momentum Δ &gt; +10 → BUY MORE (add 50%) · ±10 → HOLD · −10 to −25 → TRIM 30% · −25 to −40 → TRIM 60% · &lt; −40 or removed from screen → EXIT.
          New stocks with momentum &gt; 60 not in portfolio → INITIATE (5% position).
        </p>
      </CardContent>
    </Card>
  );
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
