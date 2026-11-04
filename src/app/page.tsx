'use client';

import { useState, useCallback, useEffect, useRef, useMemo, Fragment } from "react";
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
  Bell, BellRing, History, GitCompare, SlidersHorizontal, Search, Star, Send,
  Plus, Pencil,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

import { ScreenedStock, AllocationStock, StopLossStock, StressScenario, SetupType, SetupGrade } from "@/lib/indicators";
import type { RegimeState } from "@/lib/regime";
import { Sparkline } from "@/components/sparkline";

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

// ===== Trade Journal + Position Tracker =====
type Position = {
  id: string;
  symbol: string;
  longName: string;
  entryPrice: number;
  shares: number;
  entryDate: string; // ISO
  stopPrice: number;
  target1: number;
  target2: number;
  setupType: string;
  setupGrade: string;
  signalScore: number;
  rrMultiplier: { t1: number; t2: number };
  sector?: string;
};

type ClosedTrade = {
  id: string;
  symbol: string;
  longName: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  entryDate: string;
  exitDate: string;
  pnlRupees: number;
  pnlPct: number;
  setupType: string;
  holdDays: number;
  exitReason: string; // "Target 1", "Target 2", "Stop Loss", "Manual"
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

  // ===== Publish screen results to GitHub (for Vercel live app) =====
  // ===== Watchlist — stocks you're tracking, persists in localStorage =====
  type WatchlistItem = {
    symbol: string;
    addedAt: string;
    price: number;
    setupType?: string;
    signalScore?: number;
  };
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  // Load watchlist from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("nifty_watchlist");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setWatchlist(parsed);
      }
    } catch {}
  }, []);

  // Save watchlist to localStorage whenever it changes
  useEffect(() => {
    try { localStorage.setItem("nifty_watchlist", JSON.stringify(watchlist)); } catch {}
  }, [watchlist]);

  const addToWatchlist = useCallback((stock: any) => {
    setWatchlist(prev => {
      if (prev.some(w => w.symbol === stock.symbol)) return prev;
      return [...prev, {
        symbol: stock.symbol,
        addedAt: new Date().toISOString(),
        price: stock.currentPrice,
        setupType: stock.setupType,
        signalScore: stock.signalScore,
      }];
    });
    toast({ title: "⭐ Added to Watchlist", description: stock.symbol });
  }, []);

  const removeFromWatchlist = useCallback((symbol: string) => {
    setWatchlist(prev => prev.filter(w => w.symbol !== symbol));
    toast({ title: "Removed from Watchlist", description: symbol });
  }, []);

  const isInWatchlist = useCallback((symbol: string) => {
    return watchlist.some(w => w.symbol === symbol);
  }, [watchlist]);

  // ===== Trade Journal + Position Tracker =====
  const [positions, setPositions] = useState<Position[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [positionPrices, setPositionPrices] = useState<Record<string, number>>({});

  // Load positions + closed trades from localStorage on mount
  useEffect(() => {
    try {
      const sp = localStorage.getItem("nifty_positions");
      if (sp) { const parsed = JSON.parse(sp); if (Array.isArray(parsed)) setPositions(parsed); }
      const sc = localStorage.getItem("nifty_closed_trades");
      if (sc) { const parsed = JSON.parse(sc); if (Array.isArray(parsed)) setClosedTrades(parsed); }
    } catch {}
  }, []);

  // Persist positions + closed trades on change
  useEffect(() => {
    try { localStorage.setItem("nifty_positions", JSON.stringify(positions)); } catch {}
  }, [positions]);
  useEffect(() => {
    try { localStorage.setItem("nifty_closed_trades", JSON.stringify(closedTrades)); } catch {}
  }, [closedTrades]);

  const openPosition = useCallback((stock: any) => {
    // Auto-log: entry=currentPrice, stop=stopPrice, targets from R:R presets
    const rr = getRRForSetup(stock.setupType, rrOverride);
    const risk = stock.entryPrice - stock.stopPrice;
    const pos: Position = {
      id: `${stock.symbol}-${Date.now()}`,
      symbol: stock.symbol,
      longName: stock.longName || stock.symbol,
      entryPrice: stock.currentPrice,
      shares: Math.floor(10000 / stock.currentPrice), // ₹10k per position
      entryDate: new Date().toISOString(),
      stopPrice: stock.stopPrice,
      target1: stock.currentPrice + risk * rr.t1,
      target2: stock.currentPrice + risk * rr.t2,
      setupType: stock.setupType,
      setupGrade: stock.setupGrade,
      signalScore: stock.signalScore,
      rrMultiplier: rr,
      sector: stock.sector,
    };
    setPositions(prev => [...prev, pos]);
    toast({ title: "📋 Position Opened", description: `${stock.symbol} — ${pos.shares} shares @ ₹${stock.currentPrice.toFixed(0)}` });
  }, [rrOverride]);

  // Manual position entry — for stocks not in the screen
  const manualOpenPosition = useCallback((data: { symbol: string; entryPrice: number; shares: number; stopPrice?: number; target1?: number; target2?: number; setupType?: string }) => {
    const sym = data.symbol.toUpperCase().replace(/\.NS$/, "").trim();
    if (!sym) { toast({ title: "Symbol required", variant: "destructive" }); return; }
    if (positions.some(p => p.symbol === sym)) { toast({ title: "Position already open", description: `${sym} is already in your positions`, variant: "destructive" }); return; }
    const entry = data.entryPrice;
    const stop = data.stopPrice || entry * 0.95; // default 5% stop
    const risk = entry - stop;
    const rr = getRRForSetup(data.setupType || "UPTREND", rrOverride);
    const pos: Position = {
      id: `${sym}-${Date.now()}`,
      symbol: sym,
      longName: sym,
      entryPrice: entry,
      shares: data.shares,
      entryDate: new Date().toISOString(),
      stopPrice: stop,
      target1: data.target1 || entry + risk * rr.t1,
      target2: data.target2 || entry + risk * rr.t2,
      setupType: data.setupType || "MANUAL",
      setupGrade: "—",
      signalScore: 0,
      rrMultiplier: rr,
    };
    setPositions(prev => [...prev, pos]);
    toast({ title: "📋 Position Added", description: `${sym} — ${data.shares} shares @ ₹${entry.toFixed(0)}` });
  }, [rrOverride, positions]);

  // Edit position — update shares, entry price, stop, targets
  const updatePosition = useCallback((positionId: string, updates: Partial<Position>) => {
    setPositions(prev => prev.map(p => p.id === positionId ? { ...p, ...updates } : p));
    toast({ title: "✏️ Position Updated", description: `${updates.symbol || "Position"} updated` });
  }, []);

  const closePosition = useCallback((positionId: string, exitPrice: number, reason: string) => {
    setPositions(prev => {
      const pos = prev.find(p => p.id === positionId);
      if (!pos) return prev;
      const pnlRupees = (exitPrice - pos.entryPrice) * pos.shares;
      const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
      const holdDays = Math.floor((Date.now() - new Date(pos.entryDate).getTime()) / (1000 * 60 * 60 * 24));
      const closed: ClosedTrade = {
        ...pos,
        exitPrice,
        exitDate: new Date().toISOString(),
        pnlRupees,
        pnlPct,
        holdDays,
        exitReason: reason,
      };
      setClosedTrades(prev2 => [...prev2, closed]);
      toast({ title: "✅ Position Closed", description: `${pos.symbol} — P&L: ${pnlRupees >= 0 ? "+" : ""}₹${Math.round(pnlRupees).toLocaleString("en-IN")} (${pnlPct.toFixed(1)}%)` });
      // Clean up cached live price for this symbol (only if no other open position has it)
      setPositionPrices(prevP => {
        const stillOpen = prev.filter(p => p.symbol === pos.symbol && p.id !== pos.id);
        if (stillOpen.length > 0) return prevP;
        const next = { ...prevP };
        delete next[pos.symbol];
        return next;
      });
      return prev.filter(p => p.id !== positionId);
    });
  }, []);

  const isPositionOpen = useCallback((symbol: string) => {
    return positions.some(p => p.symbol === symbol);
  }, [positions]);

  // Refresh live prices for all open positions via /api/refresh-prices
  const [positionPricesLoading, setPositionPricesLoading] = useState(false);
  const refreshPositionPrices = useCallback(async () => {
    if (positions.length === 0) return;
    setPositionPricesLoading(true);
    try {
      const kiteTok = kiteAccessTokenRef.current || "";
      const stocks = positions.map(p => ({ symbol: p.symbol, currentPrice: p.entryPrice }));
      const res = await fetch("/api/refresh-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks, kiteToken: kiteTok }),
      });
      if (!res.ok) throw new Error("Price refresh failed");
      const data = await res.json();
      if (data.prices) {
        const map: Record<string, number> = {};
        for (const [sym, info] of Object.entries(data.prices)) {
          map[sym] = (info as any).price;
        }
        setPositionPrices(prev => ({ ...prev, ...map }));
        const count = Object.keys(map).length;
        const src = data.source === "zerodha" ? "Zerodha" : data.source === "python" ? "Python yfinance" : "Yahoo";
        toast({ title: "✅ Position prices refreshed", description: `${count} positions updated from ${src}` });
      } else if (data.error) {
        toast({ title: "Price refresh failed", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Price refresh failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setPositionPricesLoading(false);
    }
  }, [positions]);

  // ===== Telegram alerts config =====
  const [telegramConfig, setTelegramConfig] = useState<{ botToken: string; chatId: string; enabled: boolean }>({
    botToken: "",
    chatId: "",
    enabled: false,
  });

  useEffect(() => {
    try {
      const stored = localStorage.getItem("nifty_telegram");
      if (stored) setTelegramConfig(JSON.parse(stored));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("nifty_telegram", JSON.stringify(telegramConfig)); } catch {}
  }, [telegramConfig]);

  const sendTelegramAlert = useCallback(async (message: string) => {
    if (!telegramConfig.enabled || !telegramConfig.botToken || !telegramConfig.chatId) return;
    try {
      await fetch(`/api/telegram-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken: telegramConfig.botToken,
          chatId: telegramConfig.chatId,
          message,
        }),
      });
    } catch {}
  }, [telegramConfig]);

  // Send alert when screen completes with new A+ stocks
  const lastTelegramAlertedRef = useRef<string>("");
  useEffect(() => {
    if (!screen?.top10 || !telegramConfig.enabled) return;
    const aPlusStocks = screen.top10.filter((s: any) => s.setupGrade === "A+" || (s.signalScore ?? 0) >= 85);
    if (aPlusStocks.length === 0) return;
    const symbols = aPlusStocks.map((s: any) => s.symbol).sort().join(",");
    if (lastTelegramAlertedRef.current === symbols) return;
    lastTelegramAlertedRef.current = symbols;
    const msg = `🚀 ${aPlusStocks.length} new A+ signal${aPlusStocks.length > 1 ? "s" : ""}:\n${aPlusStocks.map((s: any) => `• ${s.symbol} — ${s.setupType} (Signal: ${s.signalScore})`).join("\n")}`;
    sendTelegramAlert(msg);
  }, [screen?.runAt, telegramConfig.enabled, sendTelegramAlert]);

  // ===== Auto-alert when positions are near stop/target =====
  const lastPositionAlertRef = useRef<string>("");
  useEffect(() => {
    if (positions.length === 0 || Object.keys(positionPrices).length === 0) return;
    const alerts: string[] = [];
    for (const pos of positions) {
      const price = positionPrices[pos.symbol];
      if (!price) continue;
      const nearStop = Math.abs(price - pos.stopPrice) / pos.stopPrice <= 0.02;
      const nearT1 = Math.abs(price - pos.target1) / pos.target1 <= 0.02;
      const nearT2 = Math.abs(price - pos.target2) / pos.target2 <= 0.02;
      if (nearStop) alerts.push(`🔴 ${pos.symbol} near STOP ₹${pos.stopPrice.toFixed(0)} (now ₹${price.toFixed(0)})`);
      if (nearT1) alerts.push(`🟢 ${pos.symbol} near TARGET 1 ₹${pos.target1.toFixed(0)} (now ₹${price.toFixed(0)})`);
      if (nearT2) alerts.push(`🟢 ${pos.symbol} near TARGET 2 ₹${pos.target2.toFixed(0)} (now ₹${price.toFixed(0)})`);
    }
    if (alerts.length === 0) { lastPositionAlertRef.current = ""; return; }
    const alertKey = alerts.join("|");
    if (lastPositionAlertRef.current === alertKey) return;
    lastPositionAlertRef.current = alertKey;
    sendTelegramAlert(`⚠️ Position Alert:\n${alerts.join("\n")}`);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Position Alert", { body: alerts.join("\n") });
    }
  }, [positionPrices, positions, sendTelegramAlert]);

  const [publishing, setPublishing] = useState(false);
  const [lastPublished, setLastPublished] = useState<string | null>(null);

  // Sparkline data — 30-day price charts for each screened stock
  const [sparklineData, setSparklineData] = useState<Record<string, number[]>>({});

  // Fetch sparkline data whenever screen results change
  useEffect(() => {
    if (!screen?.top10 || screen.top10.length === 0) {
      setSparklineData({});
      return;
    }
    const symbols = screen.top10.map((s: any) => s.symbol).join(",");
    fetch(`/api/sparklines?symbols=${symbols}`, { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        if (data.sparklines) setSparklineData(data.sparklines);
      })
      .catch(() => {});
  }, [screen?.runAt]);

  const publishToLive = useCallback(async () => {
    if (!screen || screen.top10.length === 0) {
      toast({ title: "No screen to publish", description: "Run the screen first" });
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch("/api/publish-screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(screen),
      });
      if (!res.ok) throw new Error("Publish failed");
      setLastPublished(new Date().toISOString());
      toast({ title: "✅ Published to Live!", description: `${screen.top10.length} stocks pushed to Vercel. Live app updates in ~2 min.` });
    } catch (e: any) {
      toast({ title: "Publish failed", description: e.message, variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  }, [screen]);

  // ===== Refresh Prices — fetch live LTP without re-running the full screen =====
  const [refreshingPrices, setRefreshingPrices] = useState(false);

  const refreshPrices = useCallback(async () => {
    if (!screen || screen.top10.length === 0) return;
    setRefreshingPrices(true);
    try {
      const kiteTok = kiteAccessTokenRef.current || "";
      const res = await fetch("/api/refresh-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks: screen.top10, kiteToken: kiteTok }),
      });
      if (!res.ok) throw new Error("Price refresh failed");
      const data = await res.json();
      if (data.prices) {
        // Update prices in the screen object
        const updatedTop10 = screen.top10.map((s: any) => {
          const update = data.prices[s.symbol];
          if (update) {
            return { ...s, currentPrice: update.price, _priceChange: update.changePct };
          }
          return s;
        });
        const updatedScreen = { ...screen, top10: updatedTop10, _priceRefreshedAt: data.refreshedAt };
        screenRef.current = updatedScreen;
        setScreen(updatedScreen);
        const count = Object.keys(data.prices).length;
        const src = data.source === "zerodha" ? "Zerodha" : "Yahoo";
        toast({ title: "✅ Prices refreshed", description: `${count} stocks updated from ${src}` });
      }
    } catch (e: any) {
      toast({ title: "Price refresh failed", description: e.message, variant: "destructive" });
    } finally {
      setRefreshingPrices(false);
    }
  }, [screen]);

  // ===== Screen History — snapshot full top 30 on every Run Screen =====
  type ScreenSnapshot = {
    date: string; mode: "momentum" | "bridge"; topN: number;
    stocks: Array<{ symbol: string; rank: number; signalScore: number; currentPrice: number; setupType: string; setupGrade: string; ret6mPct: number; ret1wPct: number; }>;
  };
  const [screenHistory, setScreenHistory] = useState<ScreenSnapshot[]>([]);
  const [historySearchSymbol, setHistorySearchSymbol] = useState<string>("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("nifty_screen_history");
      if (stored) {
        const parsed = JSON.parse(stored) as ScreenSnapshot[];
        if (Array.isArray(parsed)) {
          const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
          setScreenHistory(parsed.filter(s => new Date(s.date).getTime() > cutoff));
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("nifty_screen_history", JSON.stringify(screenHistory.slice(-200))); } catch {}
  }, [screenHistory]);

  useEffect(() => {
    if (screen?.top10?.length > 0 && screen.runAt) {
      const snapshot: ScreenSnapshot = {
        date: screen.runAt, mode: screenMode, topN: screen.top10.length,
        stocks: screen.top10.map((s: any) => ({
          symbol: s.symbol, rank: s.rank, signalScore: s.signalScore ?? 0,
          currentPrice: s.currentPrice, setupType: s.setupType ?? "UPTREND",
          setupGrade: s.setupGrade ?? "C", ret6mPct: s.ret6mPct ?? 0, ret1wPct: s.ret1wPct ?? 0,
        })),
      };
      setScreenHistory(prev => {
        if (prev.length > 0 && prev[prev.length - 1].date === snapshot.date) return prev;
        return [...prev, snapshot].slice(-200);
      });
    }
  }, [screen?.runAt, screenMode]);

  // ===== Signal Score Smoothing + Stability + Consensus =====
  const stabilityData = useMemo(() => {
    if (!screen?.top10 || screenHistory.length === 0) return {};
    const recent = screenHistory.slice(-3);
    const result: Record<string, { smoothedScore: number; stability: string; consensus: boolean; appearances: number; prevRanks: number[] }> = {};
    for (const stock of screen.top10) {
      const sym = stock.symbol;
      const scores: number[] = [];
      const ranks: number[] = [];
      let appearances = 0;
      for (const snap of recent) {
        const found = snap.stocks.find((s: any) => s.symbol === sym);
        if (found) { scores.push(found.signalScore); ranks.push(found.rank); appearances++; }
      }
      let smoothedScore = stock.signalScore ?? 0;
      if (scores.length >= 2) {
        const weights = [0.5, 0.3, 0.2].slice(0, scores.length);
        const weightSum = weights.reduce((a, b) => a + b, 0);
        smoothedScore = Math.round(scores.reduce((sum, s, i) => sum + s * weights[i], 0) / weightSum);
      }
      let stability = "NEW";
      if (ranks.length >= 2) {
        const rankChanges = ranks.slice(1).map((r, i) => Math.abs(r - ranks[i]));
        const maxChange = Math.max(...rankChanges);
        if (maxChange <= 2) stability = "STABLE";
        else if (maxChange <= 5) stability = "VOLATILE";
        else stability = "ERRATIC";
      }
      const consensus = appearances >= 2;
      result[sym] = { smoothedScore, stability, consensus, appearances, prevRanks: ranks };
    }
    return result;
  }, [screen?.runAt, screenHistory]);

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
            {/* Publish to Live — pushes screen results to GitHub for Vercel */}
            {screen && screen.top10.length > 0 && (
              <Button onClick={publishToLive} disabled={publishing} size="sm" variant="outline" className="h-7 px-2.5 text-[11px] border-emerald-300 text-emerald-700 hover:bg-emerald-50" title="Publish current screen results to the live Vercel app">
                {publishing ? <RefreshCw className="w-3 h-3 sm:mr-1 animate-spin" /> : <TrendingUp className="w-3 h-3 sm:mr-1" />}
                <span className="hidden sm:inline">{publishing ? "Publishing…" : "Publish to Live"}</span>
              </Button>
            )}
            {/* Refresh Prices — fetch live LTP for all screened stocks */}
            {screen && screen.top10.length > 0 && (
              <Button onClick={refreshPrices} disabled={refreshingPrices} size="sm" variant="outline" className="h-7 px-2.5 text-[11px] border-blue-300 text-blue-700 hover:bg-blue-50" title="Refresh live prices for all stocks without re-running the full screen">
                {refreshingPrices ? <RefreshCw className="w-3 h-3 sm:mr-1 animate-spin" /> : <Activity className="w-3 h-3 sm:mr-1" />}
                <span className="hidden sm:inline">{refreshingPrices ? "Refreshing…" : "Refresh Prices"}</span>
              </Button>
            )}
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
            <ScreenPanel screen={screen} running={running === "screen"} topN={topN} filters={filters} elapsedMs={elapsedMs} prevScreenSymbols={prevScreenSymbols} changeHistory={changeHistory} onClearHistory={() => setChangeHistory([])} regime={regime} onAnalyze={(sym) => { setTab("analyze"); runAnalyze(sym); }} rrOverride={rrOverride} setRrOverride={setRrOverride} screenMode={screenMode} screenHistory={screenHistory} historySearchSymbol={historySearchSymbol} setHistorySearchSymbol={setHistorySearchSymbol} sparklineData={sparklineData} watchlist={watchlist} addToWatchlist={addToWatchlist} removeFromWatchlist={removeFromWatchlist} isInWatchlist={isInWatchlist} onAnalyzeWatchlist={(sym) => { setTab("analyze"); runAnalyze(sym); }} telegramConfig={telegramConfig} setTelegramConfig={setTelegramConfig} sendTelegramAlert={sendTelegramAlert} stabilityData={stabilityData} positions={positions} openPosition={openPosition} closePosition={closePosition} isPositionOpen={isPositionOpen} positionPrices={positionPrices} refreshPositionPrices={refreshPositionPrices} positionPricesLoading={positionPricesLoading} closedTrades={closedTrades} manualOpenPosition={manualOpenPosition} updatePosition={updatePosition} />
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

/* ---------------------------------------------------------------- StabilityBadge */
function StabilityBadge({ stability, smoothedScore }: { stability: string; smoothedScore?: number }) {
  const styles: Record<string, string> = {
    STABLE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
    VOLATILE: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    ERRATIC: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    NEW: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  };
  return (
    <div className="flex flex-col items-center">
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold ${styles[stability] || styles.NEW}`}>
        {stability}
      </span>
      {smoothedScore !== undefined && (
        <span className="text-[9px] text-muted-foreground tabular-nums">SM: {smoothedScore.toFixed(0)}</span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- ScreenPanel */
function ScreenPanel({ screen, running, topN, filters, elapsedMs, prevScreenSymbols, changeHistory, onClearHistory, regime, onAnalyze, rrOverride, setRrOverride, screenMode, screenHistory, historySearchSymbol, setHistorySearchSymbol, sparklineData, watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist, onAnalyzeWatchlist, telegramConfig, setTelegramConfig, sendTelegramAlert, stabilityData, positions, openPosition, closePosition, isPositionOpen, positionPrices, refreshPositionPrices, positionPricesLoading, closedTrades, manualOpenPosition, updatePosition }: { screen: ScreenResponse | null; running: boolean; topN: number; filters: { rsiMin: number; mcapMin: number; volMin: number }; elapsedMs?: number; prevScreenSymbols?: string[] | null; changeHistory?: ScreenChange[]; onClearHistory?: () => void; regime?: RegimeState | null; onAnalyze?: (symbol: string) => void; rrOverride?: { t1: number; t2: number } | null; setRrOverride?: (v: { t1: number; t2: number } | null) => void; screenMode?: "momentum" | "bridge"; screenHistory?: any[]; historySearchSymbol?: string; setHistorySearchSymbol?: (v: string) => void; sparklineData?: Record<string, number[]>; watchlist?: any[]; addToWatchlist?: (stock: any) => void; removeFromWatchlist?: (symbol: string) => void; isInWatchlist?: (symbol: string) => boolean; onAnalyzeWatchlist?: (symbol: string) => void; telegramConfig?: { botToken: string; chatId: string; enabled: boolean }; setTelegramConfig?: (v: { botToken: string; chatId: string; enabled: boolean }) => void; sendTelegramAlert?: (message: string) => void; stabilityData?: Record<string, any>; positions?: Position[]; openPosition?: (stock: any) => void; closePosition?: (positionId: string, exitPrice: number, reason: string) => void; isPositionOpen?: (symbol: string) => boolean; positionPrices?: Record<string, number>; refreshPositionPrices?: () => void; positionPricesLoading?: boolean; closedTrades?: ClosedTrade[]; manualOpenPosition?: (data: { symbol: string; entryPrice: number; shares: number; stopPrice?: number; target1?: number; target2?: number; setupType?: string }) => void; updatePosition?: (positionId: string, updates: Partial<Position>) => void }) {
  // Column sort state
  const [sortCol, setSortCol] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const getSortedStocks = () => {
    if (!screen?.top10) return [];
    if (!sortCol) return screen.top10;
    const sorted = [...screen.top10].sort((a: any, b: any) => {
      let va = a[sortCol] ?? 0;
      let vb = b[sortCol] ?? 0;
      // Handle stabilityData fields
      if (sortCol === "smoothed") {
        va = stabilityData?.[a.symbol]?.smoothedScore ?? a.signalScore ?? 0;
        vb = stabilityData?.[b.symbol]?.smoothedScore ?? b.signalScore ?? 0;
      }
      if (typeof va === "string") va = va.localeCompare(vb as string);
      if (typeof vb === "string") return sortDir === "asc" ? (va as string).localeCompare(vb as string) : (vb as string).localeCompare(va as string);
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return sorted;
  };

  const sortedStocks = getSortedStocks();
  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col) return <span className="text-muted-foreground/30 cursor-pointer hover:text-muted-foreground ml-0.5">↕</span>;
    return <span className="text-primary cursor-pointer ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };
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
          <div className="table-scroll-wrapper sticky-header-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Symbol</TableHead>
                  {screenMode === "bridge" ? (
                    <>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("monthlyRsi")}>Monthly RSI <SortIcon col="monthlyRsi" /></TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("bridgeScore")}>Bridge <SortIcon col="bridgeScore" /></TableHead>
                      <TableHead>Active Tactic</TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("entryPrice")}>Entry <SortIcon col="entryPrice" /></TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("trailingSL")}>Trailing SL <SortIcon col="trailingSL" /></TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("riskPct")}>Risk% <SortIcon col="riskPct" /></TableHead>
                      <TableHead className="text-center hidden lg:table-cell">Trend</TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("ret1wPct")}>1W % <SortIcon col="ret1wPct" /></TableHead>
                      <TableHead className="text-right hidden sm:table-cell cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("ret1mPct")}>1M % <SortIcon col="ret1mPct" /></TableHead>
                      <TableHead className="text-right hidden sm:table-cell cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("ret6mPct")}>6M % <SortIcon col="ret6mPct" /></TableHead>
                      <TableHead className="text-right hidden md:table-cell cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("currentPrice")}>Price <SortIcon col="currentPrice" /></TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="hidden md:table-cell">Sector</TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("currentPrice")}>Price (₹) <SortIcon col="currentPrice" /></TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("rsi14")}>RSI <SortIcon col="rsi14" /></TableHead>
                      <TableHead className="text-right hidden sm:table-cell">MCap (₹Cr)</TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("ret1wPct")}>1W % <SortIcon col="ret1wPct" /></TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("ret1mPct")}>1M % <SortIcon col="ret1mPct" /></TableHead>
                      <TableHead className="text-right hidden sm:table-cell cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("ret3mPct")}>3M % <SortIcon col="ret3mPct" /></TableHead>
                      <TableHead className="text-right hidden md:table-cell cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("ret6mPct")}>6M % <SortIcon col="ret6mPct" /></TableHead>
                      <TableHead className="text-right hidden lg:table-cell cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("sharpe")}>Sharpe <SortIcon col="sharpe" /></TableHead>
                      <TableHead>Setup</TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("signalScore")}>Signal <SortIcon col="signalScore" /></TableHead>
                      <TableHead className="text-right cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("smoothed")}>Smooth <SortIcon col="smoothed" /></TableHead>
                      <TableHead className="text-center">Stability</TableHead>
                      <TableHead className="text-center hidden lg:table-cell">Trend</TableHead>
                      <TableHead className="text-right hidden md:table-cell cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("stopPrice")}>Stop (₹) <SortIcon col="stopPrice" /></TableHead>
                      <TableHead className="text-right hidden md:table-cell cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("riskReward")}>R:R <SortIcon col="riskReward" /></TableHead>
                      <TableHead className="text-right hidden lg:table-cell cursor-pointer select-none hover:text-primary" onClick={() => toggleSort("volMult")}>Vol <SortIcon col="volMult" /></TableHead>
                    </>
                  )}
                  {screenMode !== "bridge" && <TableHead className="text-center">Buy</TableHead>}
                  <TableHead className="w-10 text-center"><Star className="w-3 h-3 inline text-muted-foreground" /></TableHead>
                  {onAnalyze && <TableHead className="text-right">Analyze</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedStocks.map((s: any) => (
                  <TableRow key={s.symbol}>
                    <TableCell className="font-bold text-muted-foreground/70">{s.rank}</TableCell>
                    <TableCell>
                      <div className="font-semibold">{s.symbol}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1 max-w-[160px]">{s.longName}</div>
                      {screenMode !== "bridge" && (!stabilityData?.[s.symbol] || !stabilityData[s.symbol]?.consensus) && (
                        <span className="text-[8px] text-amber-600 font-medium">⚠ NEW</span>
                      )}
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
                        <TableCell className="text-center hidden lg:table-cell">
                          <Sparkline prices={sparklineData?.[s.symbol] || []} width={50} height={18} />
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
                        <TableCell className="text-right tabular-nums"><ReturnCell pct={s.ret1wPct} /></TableCell>
                        <TableCell className="text-right tabular-nums"><ReturnCell pct={s.ret1mPct} /></TableCell>
                        <TableCell className="text-right hidden sm:table-cell tabular-nums"><ReturnCell pct={s.ret3mPct} /></TableCell>
                        <TableCell className="text-right hidden md:table-cell tabular-nums font-semibold"><ReturnCell pct={s.ret6mPct} /></TableCell>
                        <TableCell className="text-right hidden lg:table-cell tabular-nums">{fmt(s.sharpe)}</TableCell>
                        <TableCell><SetupBadge type={s.setupType} grade={s.setupGrade} /></TableCell>
                        <TableCell className="text-right"><SignalScoreBadge score={s.signalScore} /></TableCell>
                        <TableCell className="text-right">
                          <SignalScoreBadge score={stabilityData?.[s.symbol]?.smoothedScore ?? s.signalScore} />
                        </TableCell>
                        <TableCell className="text-center">
                          <StabilityBadge stability={stabilityData?.[s.symbol]?.stability ?? "NEW"} smoothedScore={stabilityData?.[s.symbol]?.smoothedScore} />
                        </TableCell>
                        <TableCell className="text-center hidden lg:table-cell">
                          <Sparkline prices={sparklineData?.[s.symbol] || []} width={50} height={18} />
                        </TableCell>
                        <TableCell className="text-right hidden md:table-cell tabular-nums text-red-600 font-semibold">₹{fmt(s.stopPrice)}</TableCell>
                        <TableCell className="text-right hidden md:table-cell tabular-nums">
                          <span className="text-[10px] font-semibold">{getRRForSetup(s.setupType, rrOverride ?? null).t2.toFixed(1)}:1</span>
                        </TableCell>
                        <TableCell className="text-right hidden lg:table-cell">
                          <VolMultBadge mult={s.volMult} tag={s.vsaTag} />
                        </TableCell>
                      </>
                    )}
                    {screenMode !== "bridge" && (
                      <TableCell className="text-center">
                        {isPositionOpen?.(s.symbol) ? (
                          <Badge className="bg-emerald-100 text-emerald-700 text-[9px]">OPEN</Badge>
                        ) : (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => openPosition?.(s)}>
                            <Wallet className="w-3 h-3" /> Buy
                          </Button>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-center">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { if (isInWatchlist?.(s.symbol)) removeFromWatchlist?.(s.symbol); else addToWatchlist?.(s); }} title={isInWatchlist?.(s.symbol) ? "Remove from watchlist" : "Add to watchlist"}>
                        <Star className={`h-4 w-4 ${isInWatchlist?.(s.symbol) ? "text-yellow-500 fill-yellow-400" : "text-muted-foreground"}`} />
                      </Button>
                    </TableCell>
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

      {/* Position History — search a symbol to see its rank over time */}
      <ScreenHistoryCard
        history={screenHistory || []}
        searchSymbol={historySearchSymbol || ""}
        setSearchSymbol={setHistorySearchSymbol || (() => {})}
        currentScreenSymbols={screen?.top10?.map((s: any) => s.symbol) || []}
      />

      {/* Open Positions — paper trade tracker */}
      <PositionsCard
        positions={positions || []}
        positionPrices={positionPrices || {}}
        onRefreshPrices={refreshPositionPrices}
        refreshing={!!positionPricesLoading}
        onClose={closePosition}
        onManualOpen={manualOpenPosition}
        onUpdate={updatePosition}
      />

      {/* Trade Journal — closed trade history + win rate by setup */}
      <TradeJournalCard
        closedTrades={closedTrades || []}
      />

      {/* Watchlist — starred stocks, persisted in localStorage */}
      <WatchlistCard
        watchlist={watchlist || []}
        onAnalyze={onAnalyzeWatchlist}
        onRemove={removeFromWatchlist}
      />

      {/* Telegram Alerts settings */}
      <TelegramSettingsCard
        config={telegramConfig || { botToken: "", chatId: "", enabled: false }}
        setConfig={setTelegramConfig}
        sendAlert={sendTelegramAlert}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- WatchlistCard */
function WatchlistCard({ watchlist, onAnalyze, onRemove }: {
  watchlist: any[];
  onAnalyze?: (symbol: string) => void;
  onRemove?: (symbol: string) => void;
}) {
  return (
    <Card className="card-pastel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Star className="w-4 h-4 text-yellow-500 fill-yellow-400" />
          ⭐ Watchlist
          <Badge variant="secondary" className="text-[10px] tabular-nums h-5">{watchlist.length}</Badge>
        </CardTitle>
        <CardDescription className="text-[10px]">
          Stocks you're tracking · saved in your browser · click the ⭐ next to any stock to add or remove it
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {watchlist.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
            No stocks in watchlist. Click the star icon next to any stock to add it.
          </div>
        ) : (
          <div className="table-scroll-wrapper sticky-header-table max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">Symbol</TableHead>
                  <TableHead className="text-[10px]">Setup</TableHead>
                  <TableHead className="text-[10px] text-right">Signal</TableHead>
                  <TableHead className="text-[10px] text-right">Price</TableHead>
                  <TableHead className="text-[10px]">Added</TableHead>
                  <TableHead className="text-[10px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {watchlist.map((w) => (
                  <TableRow key={w.symbol}>
                    <TableCell className="font-semibold text-sm">{w.symbol}</TableCell>
                    <TableCell>
                      {w.setupType
                        ? <SetupBadge type={w.setupType as SetupType} />
                        : <span className="text-muted-foreground text-[10px]">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {typeof w.signalScore === "number"
                        ? <SignalScoreBadge score={w.signalScore} />
                        : <span className="text-muted-foreground text-[10px]">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">₹{fmt(w.price)}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground tabular-nums">{fmtISTDate(w.addedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        {onAnalyze && (
                          <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => onAnalyze(w.symbol)} title="Analyze">
                            <Search className="w-3 h-3" /> 🔍
                          </Button>
                        )}
                        {onRemove && (
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600" onClick={() => onRemove(w.symbol)} title="Remove">
                            ✕
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- PositionsCard */
function PositionsCard({ positions, positionPrices, onRefreshPrices, refreshing, onClose, onManualOpen, onUpdate }: {
  positions: Position[];
  positionPrices: Record<string, number>;
  onRefreshPrices?: () => void;
  refreshing?: boolean;
  onClose?: (positionId: string, exitPrice: number, reason: string) => void;
  onManualOpen?: (data: { symbol: string; entryPrice: number; shares: number; stopPrice?: number; target1?: number; target2?: number; setupType?: string }) => void;
  onUpdate?: (positionId: string, updates: Partial<Position>) => void;
}) {
  // Track which position's inline close form is open + form values
  const [closingId, setClosingId] = useState<string | null>(null);
  const [exitPriceInput, setExitPriceInput] = useState<string>("");
  const [exitReason, setExitReason] = useState<string>("Manual");

  // Add Position inline form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<{
    symbol: string; entryPrice: string; shares: string;
    stopPrice: string; target1: string; target2: string; setupType: string;
  }>({ symbol: "", entryPrice: "", shares: "", stopPrice: "", target1: "", target2: "", setupType: "MANUAL" });

  // Edit Position inline form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    shares: string; entryPrice: string; stopPrice: string; target1: string; target2: string;
  }>({ shares: "", entryPrice: "", stopPrice: "", target1: "", target2: "" });

  const resetAddForm = () => setAddForm({ symbol: "", entryPrice: "", shares: "", stopPrice: "", target1: "", target2: "", setupType: "MANUAL" });

  const cancelAdd = () => { setShowAddForm(false); resetAddForm(); };

  const confirmAdd = () => {
    const symbol = addForm.symbol.toUpperCase().trim();
    const entryPrice = parseFloat(addForm.entryPrice);
    const shares = parseInt(addForm.shares, 10);
    if (!symbol) { toast({ title: "Symbol required", variant: "destructive" }); return; }
    if (isNaN(entryPrice) || entryPrice <= 0) { toast({ title: "Invalid entry price", description: "Enter a valid positive number", variant: "destructive" }); return; }
    if (isNaN(shares) || shares <= 0) { toast({ title: "Invalid shares", description: "Enter a positive integer", variant: "destructive" }); return; }
    const stopPrice = addForm.stopPrice ? parseFloat(addForm.stopPrice) : undefined;
    const target1 = addForm.target1 ? parseFloat(addForm.target1) : undefined;
    const target2 = addForm.target2 ? parseFloat(addForm.target2) : undefined;
    if (stopPrice !== undefined && (isNaN(stopPrice) || stopPrice <= 0)) { toast({ title: "Invalid stop price", variant: "destructive" }); return; }
    if (target1 !== undefined && (isNaN(target1) || target1 <= 0)) { toast({ title: "Invalid target 1", variant: "destructive" }); return; }
    if (target2 !== undefined && (isNaN(target2) || target2 <= 0)) { toast({ title: "Invalid target 2", variant: "destructive" }); return; }
    onManualOpen?.({ symbol, entryPrice, shares, stopPrice, target1, target2, setupType: addForm.setupType });
    cancelAdd();
  };

  const startEdit = (p: Position) => {
    setEditingId(p.id);
    setEditForm({
      shares: String(p.shares),
      entryPrice: String(p.entryPrice),
      stopPrice: p.stopPrice ? String(p.stopPrice) : "",
      target1: p.target1 ? String(p.target1) : "",
      target2: p.target2 ? String(p.target2) : "",
    });
    // close any open close form
    setClosingId(null);
    setExitPriceInput("");
    setExitReason("Manual");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ shares: "", entryPrice: "", stopPrice: "", target1: "", target2: "" });
  };

  const confirmEdit = (p: Position) => {
    const shares = parseInt(editForm.shares, 10);
    const entryPrice = parseFloat(editForm.entryPrice);
    if (isNaN(shares) || shares <= 0) { toast({ title: "Invalid shares", description: "Enter a positive integer", variant: "destructive" }); return; }
    if (isNaN(entryPrice) || entryPrice <= 0) { toast({ title: "Invalid entry price", description: "Enter a valid positive number", variant: "destructive" }); return; }
    const stopPrice = editForm.stopPrice ? parseFloat(editForm.stopPrice) : 0;
    const target1 = editForm.target1 ? parseFloat(editForm.target1) : 0;
    const target2 = editForm.target2 ? parseFloat(editForm.target2) : 0;
    if (stopPrice !== 0 && (isNaN(stopPrice) || stopPrice <= 0)) { toast({ title: "Invalid stop price", variant: "destructive" }); return; }
    if (target1 !== 0 && (isNaN(target1) || target1 <= 0)) { toast({ title: "Invalid target 1", variant: "destructive" }); return; }
    if (target2 !== 0 && (isNaN(target2) || target2 <= 0)) { toast({ title: "Invalid target 2", variant: "destructive" }); return; }
    onUpdate?.(p.id, { shares, entryPrice, stopPrice, target1, target2 });
    cancelEdit();
  };

  const startClose = (p: Position) => {
    const livePrice = positionPrices[p.symbol] ?? p.entryPrice;
    setClosingId(p.id);
    setExitPriceInput(String(livePrice.toFixed(2)));
    setExitReason("Manual");
    // close any open edit form
    setEditingId(null);
    setEditForm({ shares: "", entryPrice: "", stopPrice: "", target1: "", target2: "" });
  };

  const cancelClose = () => {
    setClosingId(null);
    setExitPriceInput("");
    setExitReason("Manual");
  };

  const confirmClose = (p: Position) => {
    const price = parseFloat(exitPriceInput);
    if (isNaN(price) || price <= 0) {
      toast({ title: "Invalid exit price", description: "Enter a valid positive number", variant: "destructive" });
      return;
    }
    onClose?.(p.id, price, exitReason);
    cancelClose();
  };

  // Status badge logic — within 2% of stop/target, within 1% of entry
  const getStatusBadge = (p: Position, currentPrice: number) => {
    if (currentPrice <= 0 || p.entryPrice <= 0) return <span className="text-muted-foreground text-[10px]">—</span>;
    const nearSl = p.stopPrice > 0 && Math.abs(currentPrice - p.stopPrice) / p.stopPrice <= 0.02;
    const nearT1 = p.target1 > 0 && Math.abs(currentPrice - p.target1) / p.target1 <= 0.02;
    const nearT2 = p.target2 > 0 && Math.abs(currentPrice - p.target2) / p.target2 <= 0.02;
    const atEntry = Math.abs(currentPrice - p.entryPrice) / p.entryPrice <= 0.01;
    // Priority: SL > T2 > T1 > At Entry
    if (nearSl) return <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">🔴 Near SL</span>;
    if (nearT2) return <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">🟢 Near T2</span>;
    if (nearT1) return <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">🟢 Near T1</span>;
    if (atEntry) return <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">🟡 At Entry</span>;
    return <span className="text-muted-foreground text-[10px]">—</span>;
  };

  return (
    <Card className="card-pastel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="w-4 h-4 text-emerald-600" />
            📋 Open Positions
            <Badge variant="secondary" className="text-[10px] tabular-nums h-5">{positions.length}</Badge>
          </CardTitle>
          <CardDescription className="text-[10px] mt-0.5">
            Paper trade tracker · auto-logs entry, stop, targets, P&amp;L · saved in your browser
          </CardDescription>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onManualOpen && (
            <Button
              onClick={() => showAddForm ? cancelAdd() : setShowAddForm(true)}
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              <Plus className="w-3 h-3" />
              <span className="hidden sm:inline">{showAddForm ? "Cancel Add" : "Add Position"}</span>
              <span className="sm:hidden">{showAddForm ? "✕" : "+"}</span>
            </Button>
          )}
          {positions.length > 0 && onRefreshPrices && (
            <Button onClick={onRefreshPrices} disabled={refreshing} size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-blue-300 text-blue-700 hover:bg-blue-50">
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh Prices"}</span>
              <span className="sm:hidden">{refreshing ? "…" : "LTP"}</span>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Inline Add Position form */}
        {showAddForm && onManualOpen && (
          <div className="mb-3 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-900/10 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Plus className="w-3.5 h-3.5 text-emerald-700" />
              <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">Add Position Manually</span>
              <span className="text-[9px] text-muted-foreground ml-1">· stop / T1 / T2 default from setup RR if blank</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 items-end">
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] text-muted-foreground">Symbol</Label>
                <Input
                  value={addForm.symbol}
                  onChange={(e) => setAddForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                  placeholder="EBGNG"
                  className="h-7 text-[11px] uppercase"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") confirmAdd(); if (e.key === "Escape") cancelAdd(); }}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] text-muted-foreground">Entry ₹</Label>
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  value={addForm.entryPrice}
                  onChange={(e) => setAddForm(f => ({ ...f, entryPrice: e.target.value }))}
                  placeholder="723"
                  className="h-7 text-[11px] tabular-nums"
                  onKeyDown={(e) => { if (e.key === "Enter") confirmAdd(); if (e.key === "Escape") cancelAdd(); }}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] text-muted-foreground">Shares</Label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={addForm.shares}
                  onChange={(e) => setAddForm(f => ({ ...f, shares: e.target.value }))}
                  placeholder="10"
                  className="h-7 text-[11px] tabular-nums"
                  onKeyDown={(e) => { if (e.key === "Enter") confirmAdd(); if (e.key === "Escape") cancelAdd(); }}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] text-muted-foreground">Stop ₹ (optional)</Label>
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  value={addForm.stopPrice}
                  onChange={(e) => setAddForm(f => ({ ...f, stopPrice: e.target.value }))}
                  placeholder="defaults 5% below"
                  className="h-7 text-[11px] tabular-nums"
                  onKeyDown={(e) => { if (e.key === "Enter") confirmAdd(); if (e.key === "Escape") cancelAdd(); }}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] text-muted-foreground">Target 1 ₹ (optional)</Label>
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  value={addForm.target1}
                  onChange={(e) => setAddForm(f => ({ ...f, target1: e.target.value }))}
                  placeholder="optional"
                  className="h-7 text-[11px] tabular-nums"
                  onKeyDown={(e) => { if (e.key === "Enter") confirmAdd(); if (e.key === "Escape") cancelAdd(); }}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] text-muted-foreground">Target 2 ₹ (optional)</Label>
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  value={addForm.target2}
                  onChange={(e) => setAddForm(f => ({ ...f, target2: e.target.value }))}
                  placeholder="optional"
                  className="h-7 text-[11px] tabular-nums"
                  onKeyDown={(e) => { if (e.key === "Enter") confirmAdd(); if (e.key === "Escape") cancelAdd(); }}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] text-muted-foreground">Setup Type</Label>
                <Select value={addForm.setupType} onValueChange={(v) => setAddForm(f => ({ ...f, setupType: v }))}>
                  <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BREAKOUT">BREAKOUT</SelectItem>
                    <SelectItem value="PULLBACK">PULLBACK</SelectItem>
                    <SelectItem value="UPTREND">UPTREND</SelectItem>
                    <SelectItem value="MANUAL">MANUAL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-1 mt-2 justify-end">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={cancelAdd}>Cancel</Button>
              <Button size="sm" variant="default" className="h-7 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white gap-1" onClick={confirmAdd}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>
          </div>
        )}
        {positions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
            {showAddForm ? (
              <>Fill the form above and click <span className="font-semibold text-emerald-700">Add</span> to create your first position.</>
            ) : (
              <>No open positions. Click &apos;Buy&apos; next to any stock to open a position{onManualOpen ? ", or use &apos;Add Position&apos; to enter one manually" : ""}.</>
            )}
          </div>
        ) : (
          <div className="table-scroll-wrapper sticky-header-table max-h-[28rem] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">Symbol</TableHead>
                  <TableHead className="text-[10px] text-right">Entry ₹</TableHead>
                  <TableHead className="text-[10px] text-right">Current ₹</TableHead>
                  <TableHead className="text-[10px] text-right">Shares</TableHead>
                  <TableHead className="text-[10px] text-right">P&amp;L ₹</TableHead>
                  <TableHead className="text-[10px] text-right">P&amp;L %</TableHead>
                  <TableHead className="text-[10px] text-right hidden md:table-cell">Stop ₹</TableHead>
                  <TableHead className="text-[10px] text-right hidden md:table-cell">T1 ₹</TableHead>
                  <TableHead className="text-[10px] text-right hidden lg:table-cell">T2 ₹</TableHead>
                  <TableHead className="text-[10px] text-center">Status</TableHead>
                  <TableHead className="text-[10px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((p) => {
                  const currentPrice = positionPrices[p.symbol] ?? p.entryPrice;
                  const pnlRupees = (currentPrice - p.entryPrice) * p.shares;
                  const pnlPct = ((currentPrice - p.entryPrice) / p.entryPrice) * 100;
                  const pnlPos = pnlRupees >= 0;
                  const isClosingThis = closingId === p.id;
                  const isEditingThis = editingId === p.id;
                  return (
                    <Fragment key={p.id}>
                      <TableRow>
                        <TableCell>
                          <div className="font-bold text-xs">{p.symbol}</div>
                          <div className="text-[9px] text-muted-foreground line-clamp-1 max-w-[120px]">{p.longName}</div>
                          <div className="mt-0.5">
                            <SetupBadge type={(p.setupType as SetupType) || "UPTREND"} grade={(p.setupGrade as SetupGrade) || undefined} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px]">{fmt(p.entryPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] font-medium">
                          {positionPrices[p.symbol] ? (
                            <span title="Live (refreshed)">₹{fmt(currentPrice)}</span>
                          ) : (
                            <span className="text-muted-foreground" title="Not yet refreshed — showing entry price">₹{fmt(currentPrice)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px]">{p.shares}</TableCell>
                        <TableCell className={`text-right tabular-nums text-[11px] font-semibold ${pnlPos ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {pnlPos ? "+" : "−"}₹{Math.abs(Math.round(pnlRupees)).toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums text-[11px] font-semibold ${pnlPos ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {pnlPos ? "+" : ""}{pnlPct.toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] text-red-600 dark:text-red-400 hidden md:table-cell">{fmt(p.stopPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] text-emerald-600 dark:text-emerald-400 hidden md:table-cell">{fmt(p.target1)}</TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] text-emerald-600 dark:text-emerald-400 hidden lg:table-cell">{fmt(p.target2)}</TableCell>
                        <TableCell className="text-center">{getStatusBadge(p, currentPrice)}</TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1">
                            {onUpdate && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[10px] gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                                onClick={() => isEditingThis ? cancelEdit() : startEdit(p)}
                                disabled={isClosingThis}
                                title="Edit position"
                              >
                                <Pencil className="w-3 h-3" />
                                <span className="hidden sm:inline">{isEditingThis ? "Cancel" : "Edit"}</span>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px] gap-1 border-red-300 text-red-700 hover:bg-red-50"
                              onClick={() => startClose(p)}
                              disabled={!onClose || isEditingThis}
                            >
                              ✕ Close
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isEditingThis && (
                        <TableRow className="bg-amber-50/40 dark:bg-amber-900/10">
                          <TableCell colSpan={11} className="p-2">
                            <div className="flex flex-wrap items-end gap-2 text-[11px]">
                              <div className="flex flex-col gap-0.5">
                                <Label className="text-[9px] text-muted-foreground">Shares</Label>
                                <Input
                                  type="number"
                                  step="1"
                                  min="0"
                                  value={editForm.shares}
                                  onChange={(e) => setEditForm(f => ({ ...f, shares: e.target.value }))}
                                  className="h-7 w-24 text-[11px] tabular-nums"
                                  autoFocus
                                  onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(p); if (e.key === "Escape") cancelEdit(); }}
                                />
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <Label className="text-[9px] text-muted-foreground">Entry ₹</Label>
                                <Input
                                  type="number"
                                  step="0.05"
                                  min="0"
                                  value={editForm.entryPrice}
                                  onChange={(e) => setEditForm(f => ({ ...f, entryPrice: e.target.value }))}
                                  className="h-7 w-28 text-[11px] tabular-nums"
                                  onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(p); if (e.key === "Escape") cancelEdit(); }}
                                />
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <Label className="text-[9px] text-muted-foreground">Stop ₹</Label>
                                <Input
                                  type="number"
                                  step="0.05"
                                  min="0"
                                  value={editForm.stopPrice}
                                  onChange={(e) => setEditForm(f => ({ ...f, stopPrice: e.target.value }))}
                                  className="h-7 w-28 text-[11px] tabular-nums"
                                  onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(p); if (e.key === "Escape") cancelEdit(); }}
                                />
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <Label className="text-[9px] text-muted-foreground">T1 ₹</Label>
                                <Input
                                  type="number"
                                  step="0.05"
                                  min="0"
                                  value={editForm.target1}
                                  onChange={(e) => setEditForm(f => ({ ...f, target1: e.target.value }))}
                                  className="h-7 w-28 text-[11px] tabular-nums"
                                  onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(p); if (e.key === "Escape") cancelEdit(); }}
                                />
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <Label className="text-[9px] text-muted-foreground">T2 ₹</Label>
                                <Input
                                  type="number"
                                  step="0.05"
                                  min="0"
                                  value={editForm.target2}
                                  onChange={(e) => setEditForm(f => ({ ...f, target2: e.target.value }))}
                                  className="h-7 w-28 text-[11px] tabular-nums"
                                  onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(p); if (e.key === "Escape") cancelEdit(); }}
                                />
                              </div>
                              {(() => {
                                const ep = parseFloat(editForm.entryPrice);
                                const sh = parseInt(editForm.shares, 10);
                                if (!isNaN(ep) && ep > 0 && !isNaN(sh) && sh > 0) {
                                  const pR = (currentPrice - ep) * sh;
                                  const pP = ((currentPrice - ep) / ep) * 100;
                                  return (
                                    <div className="flex flex-col gap-0.5 text-[10px]">
                                      <span className="text-muted-foreground">Preview P&amp;L</span>
                                      <span className={`font-semibold tabular-nums ${pR >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                        {pR >= 0 ? "+" : "−"}₹{Math.abs(Math.round(pR)).toLocaleString("en-IN")} ({pP >= 0 ? "+" : ""}{pP.toFixed(1)}%)
                                      </span>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                              <div className="flex gap-1 ml-auto">
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={cancelEdit}>Cancel</Button>
                                <Button size="sm" variant="default" className="h-7 px-2 text-[10px] bg-amber-600 hover:bg-amber-700 text-white" onClick={() => confirmEdit(p)}>Save</Button>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {isClosingThis && (
                        <TableRow className="bg-muted/40">
                          <TableCell colSpan={11} className="p-2">
                            <div className="flex flex-wrap items-end gap-2 text-[11px]">
                              <div className="flex flex-col gap-0.5">
                                <Label className="text-[9px] text-muted-foreground">Exit Price (₹)</Label>
                                <Input
                                  type="number"
                                  step="0.05"
                                  min="0"
                                  value={exitPriceInput}
                                  onChange={(e) => setExitPriceInput(e.target.value)}
                                  className="h-7 w-28 text-[11px] tabular-nums"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") confirmClose(p);
                                    if (e.key === "Escape") cancelClose();
                                  }}
                                />
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <Label className="text-[9px] text-muted-foreground">Exit Reason</Label>
                                <Select value={exitReason} onValueChange={setExitReason}>
                                  <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Target 1">Target 1</SelectItem>
                                    <SelectItem value="Target 2">Target 2</SelectItem>
                                    <SelectItem value="Stop Loss">Stop Loss</SelectItem>
                                    <SelectItem value="Manual">Manual</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              {(() => {
                                const ep = parseFloat(exitPriceInput);
                                if (!isNaN(ep) && ep > 0) {
                                  const pR = (ep - p.entryPrice) * p.shares;
                                  const pP = ((ep - p.entryPrice) / p.entryPrice) * 100;
                                  return (
                                    <div className="flex flex-col gap-0.5 text-[10px]">
                                      <span className="text-muted-foreground">Preview P&amp;L</span>
                                      <span className={`font-semibold tabular-nums ${pR >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                        {pR >= 0 ? "+" : "−"}₹{Math.abs(Math.round(pR)).toLocaleString("en-IN")} ({pP >= 0 ? "+" : ""}{pP.toFixed(1)}%)
                                      </span>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                              <div className="flex gap-1 ml-auto">
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={cancelClose}>Cancel</Button>
                                <Button size="sm" variant="default" className="h-7 px-2 text-[10px] bg-red-600 hover:bg-red-700 text-white" onClick={() => confirmClose(p)}>Confirm Close</Button>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- TradeJournalCard */
function TradeJournalCard({ closedTrades }: {
  closedTrades: ClosedTrade[];
}) {
  // Summary stats
  const totalTrades = closedTrades.length;
  const winners = closedTrades.filter(t => t.pnlRupees > 0).length;
  const winRate = totalTrades > 0 ? (winners / totalTrades) * 100 : 0;
  const totalPnl = closedTrades.reduce((a, t) => a + t.pnlRupees, 0);
  const avgHoldDays = totalTrades > 0
    ? closedTrades.reduce((a, t) => a + t.holdDays, 0) / totalTrades
    : 0;

  // Win rate by setup
  const setupStats: Record<string, { wins: number; total: number }> = {};
  for (const t of closedTrades) {
    const key = t.setupType || "UNKNOWN";
    if (!setupStats[key]) setupStats[key] = { wins: 0, total: 0 };
    setupStats[key].total++;
    if (t.pnlRupees > 0) setupStats[key].wins++;
  }

  const exitReasonBadge: Record<string, string> = {
    "Target 1": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    "Target 2": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    "Stop Loss": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    "Manual": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };

  return (
    <Card className="card-pastel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="w-4 h-4 text-primary" />
          📊 Trade Journal
          <Badge variant="secondary" className="text-[10px] tabular-nums h-5">{closedTrades.length}</Badge>
        </CardTitle>
        <CardDescription className="text-[10px] mt-0.5">
          Closed trade history · win rate · P&L · performance by setup type · saved in your browser
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {closedTrades.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
            No closed trades yet. Open and close positions to build your journal.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary stats — 4 boxes */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Total Trades</div>
                <div className="text-lg font-bold tabular-nums">{totalTrades}</div>
                <div className="text-[10px] text-muted-foreground">{winners}W / {totalTrades - winners}L</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Win Rate</div>
                <div className={`text-lg font-bold tabular-nums ${winRate >= 50 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{winRate.toFixed(0)}%</div>
                <div className="text-[10px] text-muted-foreground">of closed trades</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Total P&L ₹</div>
                <div className={`text-lg font-bold tabular-nums ${totalPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {totalPnl >= 0 ? "+" : "−"}₹{Math.abs(Math.round(totalPnl)).toLocaleString("en-IN")}
                </div>
                <div className="text-[10px] text-muted-foreground">net realized</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Avg Hold Days</div>
                <div className="text-lg font-bold tabular-nums">{avgHoldDays.toFixed(1)}</div>
                <div className="text-[10px] text-muted-foreground">per trade</div>
              </div>
            </div>

            {/* Closed trades table */}
            <div className="table-scroll-wrapper sticky-header-table max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Symbol</TableHead>
                    <TableHead className="text-[10px]">Setup</TableHead>
                    <TableHead className="text-[10px]">Entry Date</TableHead>
                    <TableHead className="text-[10px]">Exit Date</TableHead>
                    <TableHead className="text-[10px] text-right">Hold (d)</TableHead>
                    <TableHead className="text-[10px] text-right">Entry ₹</TableHead>
                    <TableHead className="text-[10px] text-right">Exit ₹</TableHead>
                    <TableHead className="text-[10px] text-right">P&L ₹</TableHead>
                    <TableHead className="text-[10px] text-right">P&L %</TableHead>
                    <TableHead className="text-[10px] text-center">Exit Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...closedTrades].reverse().map((t) => {
                    const pnlPos = t.pnlRupees >= 0;
                    return (
                      <TableRow key={t.id}>
                        <TableCell>
                          <div className="font-semibold text-xs">{t.symbol}</div>
                          <div className="text-[9px] text-muted-foreground line-clamp-1 max-w-[120px]">{t.longName}</div>
                        </TableCell>
                        <TableCell>
                          <SetupBadge type={(t.setupType as SetupType) || "UPTREND"} />
                        </TableCell>
                        <TableCell className="text-[10px] tabular-nums text-muted-foreground">{fmtISTDate(t.entryDate)}</TableCell>
                        <TableCell className="text-[10px] tabular-nums text-muted-foreground">{fmtISTDate(t.exitDate)}</TableCell>
                        <TableCell className="text-right tabular-nums text-[10px]">{t.holdDays}</TableCell>
                        <TableCell className="text-right tabular-nums text-[10px]">{fmt(t.entryPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums text-[10px]">{fmt(t.exitPrice)}</TableCell>
                        <TableCell className={`text-right tabular-nums text-[10px] font-semibold ${pnlPos ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {pnlPos ? "+" : "−"}₹{Math.abs(Math.round(t.pnlRupees)).toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums text-[10px] font-semibold ${pnlPos ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {pnlPos ? "+" : ""}{t.pnlPct.toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold ${exitReasonBadge[t.exitReason] || exitReasonBadge.Manual}`}>
                            {t.exitReason}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Win Rate by Setup mini-summary */}
            <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
              <div className="text-[10px] font-semibold text-muted-foreground mb-2">Win Rate by Setup</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(setupStats).map(([setup, st]) => {
                  const wr = st.total > 0 ? (st.wins / st.total) * 100 : 0;
                  const tone = wr >= 60 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : wr >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                    : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
                  return (
                    <span key={setup} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${tone}`}>
                      {setup}: {wr.toFixed(0)}% ({st.wins}/{st.total})
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- TelegramSettingsCard */
function TelegramSettingsCard({ config, setConfig, sendAlert }: {
  config: { botToken: string; chatId: string; enabled: boolean };
  setConfig?: (v: { botToken: string; chatId: string; enabled: boolean }) => void;
  sendAlert?: (message: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const handleTest = async () => {
    if (!sendAlert) return;
    if (!config.botToken || !config.chatId) {
      toast({ title: "Missing config", description: "Enter your Bot Token and Chat ID first.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      await sendAlert("✅ Test alert from Momentum Dashboard!");
      toast({ title: "Test alert sent", description: "Check your Telegram chat for the message." });
    } catch {
      toast({ title: "Failed to send", description: "Check your bot token and chat ID.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };
  return (
    <Card className="card-pastel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="w-4 h-4 text-primary" />
            Telegram Alerts
          </CardTitle>
          <CardDescription className="text-[10px] mt-0.5">
            Get notified when new A+ signals appear · config saved in your browser
          </CardDescription>
        </div>
        {setConfig && (
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => setConfig({ ...config, enabled: v })}
            aria-label="Toggle Telegram alerts"
          />
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {!config.enabled ? (
          <div className="text-xs text-muted-foreground p-3 rounded-lg border border-dashed border-border/60 text-center">
            {setConfig
              ? <>Enable the switch and <b>Configure</b> below to receive alerts.</>
              : "Telegram alerts are disabled."}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px]">Bot Token</Label>
              <Input
                type="password"
                placeholder="123456789:ABCdef..."
                value={config.botToken}
                onChange={(e) => setConfig?.({ ...config, botToken: e.target.value })}
                className="text-xs font-mono"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Chat ID</Label>
              <Input
                type="text"
                placeholder="your_chat_id"
                value={config.chatId}
                onChange={(e) => setConfig?.({ ...config, chatId: e.target.value })}
                className="text-xs font-mono"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
              <p className="text-[10px] text-muted-foreground">
                Create a bot with <b>@BotFather</b>, then get your chat ID from <b>@userinfobot</b>
              </p>
              <Button size="sm" className="h-7 text-[11px] gap-1 shrink-0" onClick={handleTest} disabled={sending || !sendAlert}>
                <Send className="w-3 h-3" /> {sending ? "Sending…" : "Send Test Alert"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- ScreenHistoryCard */
function ScreenHistoryCard({ history, searchSymbol, setSearchSymbol, currentScreenSymbols }: {
  history: any[];
  searchSymbol: string;
  setSearchSymbol: (v: string) => void;
  currentScreenSymbols: string[];
}) {
  const sym = searchSymbol.trim().toUpperCase();
  const hasHistory = history.length > 0;

  const symbolHistory = sym ? history.map(snap => {
    const stock = snap.stocks.find((s: any) => s.symbol === sym);
    return {
      date: snap.date, mode: snap.mode,
      rank: stock?.rank ?? null, signalScore: stock?.signalScore ?? null,
      price: stock?.currentPrice ?? null, setupType: stock?.setupType ?? null,
      setupGrade: stock?.setupGrade ?? null, ret6mPct: stock?.ret6mPct ?? null,
      ret1wPct: stock?.ret1wPct ?? null, inList: !!stock,
    };
  }).reverse() : [];

  const chartData = sym ? symbolHistory.slice().reverse().map(s => ({
    date: fmtISTDate(s.date), rank: s.rank ?? 0, signal: s.signalScore ?? 0, price: s.price ?? 0,
  })) : [];

  const inListCount = symbolHistory.filter(s => s.inList).length;
  const bestRank = symbolHistory.filter(s => s.inList).reduce((min, s) => s.rank < min ? s.rank : min, 999);
  const avgRank = inListCount > 0 ? (symbolHistory.filter(s => s.inList).reduce((sum, s) => sum + s.rank, 0) / inListCount) : 0;
  const currentlyInList = currentScreenSymbols.includes(sym);

  return (
    <Card className="card-pastel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="w-4 h-4 text-primary" />
          Position History
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">
            {hasHistory ? `${history.length} snapshots saved` : "No history yet"}
          </span>
        </CardTitle>
        <CardDescription className="text-[10px]">
          Type a symbol to see its rank across all past screen runs (auto-saved each time you click Run Screen)
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex gap-2">
          <Input type="text" placeholder="e.g. RELIANCE, TCS, PERSISTENT..." value={searchSymbol} onChange={(e) => setSearchSymbol(e.target.value.toUpperCase())} className="flex-1 uppercase" />
        </div>

        {currentScreenSymbols.length > 0 && !sym && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] text-muted-foreground self-center mr-1">Current list:</span>
            {currentScreenSymbols.slice(0, 10).map((s) => (
              <button key={s} onClick={() => setSearchSymbol(s)} className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted hover:bg-primary/10 hover:text-primary transition-colors">{s}</button>
            ))}
          </div>
        )}

        {!hasHistory && (
          <div className="text-xs text-muted-foreground p-3 rounded-lg border border-dashed border-border/60 text-center">
            No screen history yet. Run the screen — each run is automatically saved. After that, search any symbol to see how its rank changed over time.
          </div>
        )}

        {hasHistory && sym && inListCount === 0 && (
          <div className="text-xs text-amber-700 p-3 rounded-lg border border-amber-200 bg-amber-50/50">
            <b>{sym}</b> has not appeared in any of your {history.length} saved screen runs.
            <br /><span className="text-[10px]">It never made it into the top {history[0]?.topN || 30} by Signal Score during any run.</span>
          </div>
        )}

        {hasHistory && sym && inListCount > 0 && (
          <>
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-lg border border-border/60 bg-card/60 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">Appearances</div>
                <div className="text-sm font-bold tabular-nums">{inListCount} / {symbolHistory.length}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/60 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">Best Rank</div>
                <div className="text-sm font-bold tabular-nums text-emerald-600">#{bestRank}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/60 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">Avg Rank</div>
                <div className="text-sm font-bold tabular-nums">#{avgRank.toFixed(1)}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/60 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">Now</div>
                <div className={`text-sm font-bold tabular-nums ${currentlyInList ? "text-emerald-600" : "text-red-600"}`}>{currentlyInList ? "In list" : "Out"}</div>
              </div>
            </div>

            {chartData.length > 1 && (
              <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                <div className="text-[10px] font-semibold text-muted-foreground mb-2">Rank Timeline (lower = better)</div>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis reversed domain={[1, 'dataMax + 1']} tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ fontSize: 10, padding: 6 }} formatter={(v: any, n: string) => n === "rank" ? [`#${v}`, "Rank"] : [v, n]} />
                    <Line type="monotone" dataKey="rank" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="table-scroll-wrapper sticky-header-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Date</TableHead>
                    <TableHead className="text-[10px]">Mode</TableHead>
                    <TableHead className="text-[10px] text-right">Rank</TableHead>
                    <TableHead className="text-[10px] text-right">Signal</TableHead>
                    <TableHead className="text-[10px] text-right">Price</TableHead>
                    <TableHead className="text-[10px]">Setup</TableHead>
                    <TableHead className="text-[10px] text-right">1W %</TableHead>
                    <TableHead className="text-[10px] text-right">6M %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {symbolHistory.slice(0, 20).map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-[10px] tabular-nums">{fmtISTDate(s.date)} <span className="text-muted-foreground">{fmtISTTime(s.date)}</span></TableCell>
                      <TableCell className="text-[10px]">{s.mode}</TableCell>
                      <TableCell className="text-[10px] text-right tabular-nums font-bold">{s.inList ? `#${s.rank}` : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-[10px] text-right tabular-nums">{s.signalScore ?? "—"}</TableCell>
                      <TableCell className="text-[10px] text-right tabular-nums">{s.price ? `₹${fmt(s.price)}` : "—"}</TableCell>
                      <TableCell className="text-[10px]">{s.setupType ?? "—"}</TableCell>
                      <TableCell className="text-[10px] text-right tabular-nums">{s.ret1wPct != null ? <ReturnCell pct={s.ret1wPct} /> : "—"}</TableCell>
                      <TableCell className="text-[10px] text-right tabular-nums">{s.ret6mPct != null ? <ReturnCell pct={s.ret6mPct} /> : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
              <div className="table-scroll-wrapper sticky-header-table">
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
            <div className="table-scroll-wrapper sticky-header-table">
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
                  <div className="table-scroll-wrapper sticky-header-table">
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
              <div className="table-scroll-wrapper sticky-header-table">
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
