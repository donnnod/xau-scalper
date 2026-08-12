import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LiquiditySweepPanel } from "@/components/dashboard/LiquiditySweepPanel";
import { MacroCorrelation } from "@/components/dashboard/MacroCorrelation";
import { MarketSessionBar } from "@/components/dashboard/MarketSessionBar";
import { MiniChart } from "@/components/dashboard/MultiTimeframeView";
import { NewsShield } from "@/components/dashboard/NewsShield";
import { PriceTicker } from "@/components/dashboard/PriceTicker";
import { RegimeIndicator } from "@/components/dashboard/RegimeIndicator";
import { ScalpingToolbar } from "@/components/dashboard/ScalpingToolbar";
import { SessionBar } from "@/components/dashboard/SessionBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  analyzeForScalping,
  calcATR,
  calcEMA,
  calcMACD,
  calcRSI,
  calcStochastic,
  generateSignal,
} from "@/lib/indicators";
import {
  type Candle,
  fetchGoldCandles,
  fetchGoldPrice,
  type PriceData,
} from "@/lib/priceApi";
import {
  emptyByTf,
  TF_LABELS,
  TF_SHOW_BB,
  TIMEFRAMES,
  type Timeframe,
} from "@/lib/timeframes";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Error Boundary — catches rendering crashes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: `${error.message}\n${error.stack ?? ""}` };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-6 bg-[#0A0C10] text-white">
          <span className="text-lg font-mono text-[#D4A843]">
            ⚠ Dashboard Error
          </span>
          <pre className="text-xs text-muted-foreground text-left max-w-2xl overflow-auto whitespace-pre-wrap">
            {this.state.error || "Something went wrong."}
          </pre>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: "" });
              window.location.reload();
            }}
            className="px-4 py-2 rounded-lg bg-[#D4A843] text-black text-sm font-semibold hover:bg-[#C49A3A]"
          >
            Reload Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function DashboardContent() {
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [candlesByTf, setCandlesByTf] =
    useState<Record<Timeframe, Candle[]>>(emptyByTf);
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>("5m");

  const setTf = useCallback((tf: Timeframe, c: Candle[]) => {
    setCandlesByTf(prev => ({ ...prev, [tf]: c }));
  }, []);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [dataSource, setDataSource] = useState<string>("");

  // Phase 1: Load price + active timeframe first (fast initial paint)
  const loadCritical = useCallback(
    async (tf: Timeframe, showRefresh = false) => {
      try {
        if (showRefresh) setRefreshing(true);
        const [priceResult, candleResult] = await Promise.allSettled([
          fetchGoldPrice(),
          fetchGoldCandles(tf),
        ]);
        if (priceResult.status === "fulfilled") {
          setPriceData(priceResult.value);
          setDataSource(priceResult.value.source);
        }
        if (candleResult.status === "fulfilled") {
          setTf(tf, candleResult.value);
        }
        setLastRefresh(new Date());
      } catch (err) {
        console.error("Failed to load critical data:", err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [setTf],
  );

  // Phase 2: Background-load remaining timeframes (non-blocking)
  const loadRemaining = useCallback(
    async (activeTf: Timeframe) => {
      const remaining = TIMEFRAMES.filter(tf => tf !== activeTf);
      const results = await Promise.allSettled(
        remaining.map(tf => fetchGoldCandles(tf)),
      );
      remaining.forEach((tf, i) => {
        const r = results[i];
        if (r.status === "fulfilled") setTf(tf, r.value);
      });
    },
    [setTf],
  );

  // Full reload (for refresh button & interval)
  const loadAll = useCallback(
    async (showRefresh = false) => {
      try {
        if (showRefresh) setRefreshing(true);
        const [priceResult, ...candleResults] = await Promise.allSettled([
          fetchGoldPrice(),
          ...TIMEFRAMES.map(tf => fetchGoldCandles(tf)),
        ]);
        if (priceResult.status === "fulfilled") {
          setPriceData(priceResult.value);
          setDataSource(priceResult.value.source);
        }
        TIMEFRAMES.forEach((tf, i) => {
          const r = candleResults[i];
          if (r.status === "fulfilled") setTf(tf, r.value);
        });
        setLastRefresh(new Date());
      } catch (err) {
        console.error("Failed to load data:", err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [setTf],
  );

  // Initial mount: fast critical load, then background rest
  useEffect(() => {
    loadCritical(activeTimeframe).then(() => loadRemaining(activeTimeframe));
    const interval = setInterval(() => loadAll(), 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRemaining, loadCritical, loadAll, activeTimeframe]);

  const activeCandles = candlesByTf[activeTimeframe];

  // Scalping analysis per timeframe — wrapped in try/catch for safety
  const analysisByTf = useMemo(() => {
    const out = {} as Record<Timeframe, ReturnType<typeof analyzeForScalping>>;
    for (const tf of TIMEFRAMES) {
      try {
        out[tf] = analyzeForScalping(candlesByTf[tf]);
      } catch {
        out[tf] = null;
      }
    }
    return out;
  }, [candlesByTf]);

  const signal = useMemo(() => {
    try {
      return activeCandles.length > 50 ? generateSignal(activeCandles) : null;
    } catch {
      return null;
    }
  }, [activeCandles]);

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-3 sm:p-4 max-w-[1440px] mx-auto">
        <Skeleton className="h-8 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Skeleton className="h-[200px] rounded-xl" />
          <Skeleton className="h-[200px] rounded-xl" />
          <Skeleton className="h-[200px] rounded-xl" />
          <Skeleton className="h-[200px] rounded-xl" />
        </div>
      </div>
    );
  }

  const activeAnalysis = analysisByTf[activeTimeframe];

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4 max-w-[1440px] mx-auto w-full min-w-0 overflow-hidden">
      {/* ① Session Bar — Kill Zone timeline */}
      <SessionBar />

      {/* ② Market Sessions — Open/Closed status */}
      <MarketSessionBar />

      {/* ③ Engine Badge — own row, mobile-responsive */}
      <div
        className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 rounded-xl border transition-all"
        style={{
          backgroundColor: "rgba(212,168,67,0.04)",
          borderColor: "rgba(212,168,67,0.13)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-base sm:text-lg font-bold font-mono tracking-wide shrink-0"
            style={{ color: "#D4A843" }}
          >
            XAU Scalper
          </span>
          <span
            className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0"
            style={{
              backgroundColor: "rgba(212,168,67,0.08)",
              color: "#D4A843",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: "#D4A843" }}
            />
            LIVE ENGINE
          </span>
          <span className="text-xs text-muted-foreground hidden md:inline truncate">
            TA Multi-Indicator — ATR Trailing
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 sm:ml-auto flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">SL</span>
            <span className="text-[10px] sm:text-[11px] font-mono text-zinc-300">
              1.5× ATR
            </span>
          </div>
          <div className="w-px h-4 bg-border hidden sm:block" />
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">TP</span>
            <span className="text-[10px] sm:text-[11px] font-mono text-zinc-300">
              1.2R / 2.5R
            </span>
          </div>
          <div className="w-px h-4 bg-border hidden sm:block" />
          <span className="text-[10px] sm:text-[11px] font-mono text-[#D4A843]">
            RSI · MACD · EMA · BB · Stoch
          </span>
        </div>
      </div>

      {/* ④ Price Ticker + Refresh */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-0 overflow-hidden">
          <PriceTicker data={priceData} />
        </div>
        <div className="flex items-center gap-2 self-end sm:self-center flex-wrap min-w-0">
          {dataSource && (
            <span className="text-[10px] text-muted-foreground/50 font-mono">
              via {dataSource}
            </span>
          )}
          {lastRefresh && (
            <span className="text-xs text-muted-foreground font-mono">
              {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadAll(true)}
            disabled={refreshing}
            className="h-8 text-xs border-border bg-card hover:bg-secondary"
          >
            {refreshing ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
                Refreshing
              </span>
            ) : (
              "↻ Refresh"
            )}
          </Button>
        </div>
      </div>

      {/* ⑤ Signal Panel — compact horizontal row */}
      {signal && activeCandles.length > 50 && (
        <CompactSignalPanel signal={signal} candles={activeCandles} />
      )}

      {/* ⑥ Intel Panels — 2×2 grid on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
        <div className="min-w-0 overflow-hidden">
          <RegimeIndicator />
        </div>
        <div className="min-w-0 overflow-hidden">
          <MacroCorrelation />
        </div>
        <div className="min-w-0 overflow-hidden">
          <NewsShield />
        </div>
        <div className="min-w-0 overflow-hidden">
          <LiquiditySweepPanel />
        </div>
      </div>

      {/* ⑦ Scalping Bias & Entry/Exit Tool */}
      <ScalpingToolbar
        analysis1m={analysisByTf["1m"]}
        analysis3m={analysisByTf["3m"]}
        analysis5m={analysisByTf["5m"]}
        analysis15m={analysisByTf["15m"]}
        activeTimeframe={activeTimeframe}
        activeAnalysis={activeAnalysis}
      />

      {/* ⑤ Multi-TF Charts — 8 timeframes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {TIMEFRAMES.map(tf => ({
          tf,
          label: TF_LABELS[tf],
          candles: candlesByTf[tf],
          showBB: TF_SHOW_BB[tf],
        })).map(({ tf, label, candles, showBB }) => (
          <div
            key={tf}
            role="button"
            tabIndex={0}
            className={`cursor-pointer transition-all rounded-xl ${
              activeTimeframe === tf
                ? "ring-1 ring-[#D4A843]/50"
                : "hover:ring-1 hover:ring-[#D4A843]/20"
            }`}
            onClick={() => setActiveTimeframe(tf)}
          >
            <MiniChart
              candles={candles}
              label={label}
              height={200}
              showEMA={true}
              showBB={showBB}
            />
            {activeTimeframe === tf && (
              <div className="h-0.5 bg-[#D4A843] rounded-b-xl -mt-px mx-1" />
            )}
          </div>
        ))}
      </div>

      {/* ⑥ Pivot Points — horizontal row */}
      <PivotPointsRow
        analysis={activeAnalysis}
        currentPrice={priceData?.price ?? 0}
      />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ErrorBoundary>
      <DashboardContent />
    </ErrorBoundary>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ③ Compact Signal Panel — full-width horizontal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function CompactSignalPanel({
  signal,
  candles,
}: {
  signal: {
    type: "BUY" | "SELL" | "NEUTRAL";
    strength: number;
    reasons: string[];
  };
  candles: Candle[];
}) {
  const closes = candles.map(c => c.close);
  const last = closes.length - 1;
  if (last < 0) return null;

  let rsiVal: number | undefined;
  let stochVal: number | undefined;
  let macdVal: number | undefined;
  let macdSigVal: number | undefined;
  let ema9Val: number | undefined;
  let ema21Val: number | undefined;
  let atrVal: number | undefined;

  try {
    const rsi = calcRSI(closes, 14);
    rsiVal = rsi[last];
    const stoch = calcStochastic(candles);
    stochVal = stoch.k[last];
    const { macd, signal: ms } = calcMACD(closes);
    macdVal = macd[last];
    macdSigVal = ms[last];
    const ema9 = calcEMA(closes, 9);
    ema9Val = ema9[last];
    const ema21 = calcEMA(closes, 21);
    ema21Val = ema21[last];
    const atr = calcATR(candles, 14);
    atrVal = atr[last];
  } catch {
    // Indicator calc failed — show signal badge only
  }

  const signalColor =
    signal.type === "BUY"
      ? "#00E676"
      : signal.type === "SELL"
        ? "#FF1744"
        : "#6B7280";

  return (
    <div
      className="rounded-xl border p-2 sm:p-3 flex flex-col gap-2 sm:gap-3"
      style={{
        backgroundColor:
          signal.type === "BUY"
            ? "rgba(0,230,118,0.04)"
            : signal.type === "SELL"
              ? "rgba(255,23,68,0.04)"
              : "rgba(107,114,128,0.04)",
        borderColor:
          signal.type === "BUY"
            ? "rgba(0,230,118,0.15)"
            : signal.type === "SELL"
              ? "rgba(255,23,68,0.15)"
              : "rgba(107,114,128,0.15)",
      }}
    >
      {/* Signal Badge */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div
          className="flex items-center gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border"
          style={{
            borderColor: `${signalColor}40`,
            backgroundColor: `${signalColor}10`,
          }}
        >
          <span
            className="text-base sm:text-lg font-bold font-mono tracking-wider"
            style={{ color: signalColor }}
          >
            {signal.type}
          </span>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="w-12 sm:w-16 h-1.5 bg-secondary/50 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${signal.strength}%`,
                  backgroundColor: signalColor,
                }}
              />
            </div>
            <span
              className="text-xs font-mono tabular-nums font-semibold"
              style={{ color: signalColor }}
            >
              {signal.strength}%
            </span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-muted-foreground truncate">
            {signal.reasons[0] ?? ""}
          </span>
        </div>
      </div>

      {/* Indicator Pills */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        <IndicatorPill
          label="RSI"
          value={rsiVal}
          format={1}
          color={
            rsiVal !== undefined
              ? rsiVal < 30
                ? "#00E676"
                : rsiVal > 70
                  ? "#FF1744"
                  : undefined
              : undefined
          }
        />
        <IndicatorPill
          label="Stoch"
          value={stochVal}
          format={0}
          color={
            stochVal !== undefined
              ? stochVal < 20
                ? "#00E676"
                : stochVal > 80
                  ? "#FF1744"
                  : undefined
              : undefined
          }
        />
        <IndicatorPill
          label="MACD"
          value={macdVal}
          format={2}
          color={
            macdVal !== undefined
              ? macdVal > 0
                ? "#00E676"
                : "#FF1744"
              : undefined
          }
        />
        <IndicatorPill label="Signal" value={macdSigVal} format={2} />
        <IndicatorPill label="EMA 9" value={ema9Val} format={2} />
        <IndicatorPill label="EMA 21" value={ema21Val} format={2} />
        <IndicatorPill label="ATR" value={atrVal} format={2} color="#D4A843" />
        <div className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded bg-secondary/30">
          <span className="text-[9px] sm:text-[10px] text-muted-foreground">
            Trend
          </span>
          <span
            className={`text-[10px] sm:text-xs font-mono font-bold ${
              ema9Val !== undefined &&
              ema21Val !== undefined &&
              ema9Val > ema21Val
                ? "text-[#00E676]"
                : "text-[#FF1744]"
            }`}
          >
            {ema9Val !== undefined &&
            ema21Val !== undefined &&
            ema9Val > ema21Val
              ? "▲ BULL"
              : "▼ BEAR"}
          </span>
        </div>
      </div>
    </div>
  );
}

function IndicatorPill({
  label,
  value,
  format,
  color,
}: {
  label: string;
  value: number | undefined;
  format: number;
  color?: string;
}) {
  if (value === undefined || Number.isNaN(value)) return null;
  return (
    <div className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded bg-secondary/30">
      <span className="text-[9px] sm:text-[10px] text-muted-foreground">
        {label}
      </span>
      <span
        className="text-[10px] sm:text-xs font-mono tabular-nums font-semibold"
        style={{ color: color ?? "var(--foreground)" }}
      >
        {value.toFixed(format)}
      </span>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑥ Pivot Points — horizontal row
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function PivotPointsRow({
  analysis,
  currentPrice,
}: {
  analysis: ReturnType<typeof analyzeForScalping>;
  currentPrice: number;
}) {
  if (!analysis) {
    return (
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl bg-card border border-border">
        <span className="text-xs text-muted-foreground">
          Pivot points loading…
        </span>
      </div>
    );
  }

  const { pivotPoints: pp } = analysis;
  const levels = [
    { label: "R3", value: pp.r3, color: "#FF1744" },
    { label: "R2", value: pp.r2, color: "#FF1744" },
    { label: "R1", value: pp.r1, color: "#FF1744" },
    { label: "PP", value: pp.pivot, color: "#D4A843" },
    { label: "S1", value: pp.s1, color: "#00E676" },
    { label: "S2", value: pp.s2, color: "#00E676" },
    { label: "S3", value: pp.s3, color: "#00E676" },
  ];

  return (
    <div className="rounded-xl bg-card border border-border px-3 sm:px-4 py-2 sm:py-2.5">
      <div className="flex items-center gap-1.5 mb-1 sm:mb-0 sm:inline-flex sm:mr-2">
        <span className="text-[10px] font-medium text-muted-foreground tracking-wider uppercase shrink-0">
          Pivots
        </span>
        <div className="w-px h-4 bg-border shrink-0 hidden sm:block" />
      </div>
      <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
        {levels.map(level => {
          const isNear =
            currentPrice > 0 &&
            Math.abs(currentPrice - level.value) / currentPrice < 0.001;
          return (
            <div
              key={level.label}
              className={`flex items-center gap-1 sm:gap-1.5 shrink-0 px-1.5 sm:px-2 py-0.5 rounded ${
                isNear ? "bg-[#D4A843]/10" : ""
              }`}
            >
              <span
                className="text-[9px] sm:text-[10px] font-mono font-bold"
                style={{ color: level.color }}
              >
                {level.label}
              </span>
              <span className="text-[10px] sm:text-xs font-mono tabular-nums text-foreground">
                {level.value.toFixed(2)}
              </span>
              {isNear && (
                <span className="text-[9px] text-[#D4A843] font-medium">◄</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
