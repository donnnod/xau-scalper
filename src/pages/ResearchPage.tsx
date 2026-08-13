/**
 * Strategy discovery — pick an instrument, a timeframe and a date range, and
 * the app pulls the history from your terminal and searches for a strategy.
 *
 * WHAT THIS PAGE IS CAREFUL ABOUT
 * A screen that says "found a strategy: +4,812 points" is easy to build and
 * actively harmful, because searching thousands of configurations against one
 * history always finds something. So the result is never a single number:
 *
 *   - Three windows are shown side by side. Training is where the strategy was
 *     chosen, validation is where it was filtered, and TEST is the only one it
 *     never touched. The test column is the honest one, and it is the column
 *     the ranking uses.
 *   - The p-value is corrected for how many configurations were tried.
 *   - Rejected candidates are listed with the reason, so "the search found
 *     nothing" is visibly different from "the search did not run".
 *
 * A null result is presented as a result, not as a failure. Most searches
 * should end that way, and a page that only felt successful when it produced a
 * strategy would be pressuring its operator to keep re-rolling until it did.
 */

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Search,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLive } from "@/hooks/useLive";
import {
  ApiError,
  api,
  type BacktestMetrics,
  type BacktestResult,
  type DiscoveryCandidate,
  type ResearchRun,
  type StrategyConfig,
  type UploadResult,
} from "@/lib/api";

const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

/** Instruments people usually reach for, as a starting point rather than a limit. */
const COMMON_SYMBOLS = [
  "XAUUSD",
  "NAS100",
  "US30",
  "SPX500",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "BTCUSD",
];

const VERDICT_LABEL: Record<DiscoveryCandidate["verdict"], string> = {
  qualified: "Survived every check",
  too_few_trades: "Too few trades",
  unprofitable_in_sample: "Lost in training",
  failed_validation: "Failed validation",
  failed_test: "Failed the test window",
  not_significant: "Indistinguishable from luck",
  below_breakeven: "Below the cost breakeven",
};

function toSeconds(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}

function toDateInput(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function MetricsColumn({
  title,
  subtitle,
  metrics,
  emphasis,
}: {
  title: string;
  subtitle: string;
  metrics: BacktestMetrics;
  emphasis?: boolean;
}) {
  const positive = metrics.netPoints > 0;
  return (
    <div
      className={`rounded-lg border p-3 space-y-1 ${
        emphasis ? "border-primary/50 bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        {emphasis && (
          <Badge variant="outline" className="text-[10px]">
            unbiased
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          positive ? "text-emerald-500" : "text-destructive"
        }`}
      >
        {metrics.netPoints > 0 ? "+" : ""}
        {metrics.netPoints.toFixed(1)} pts
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {metrics.trades} trades · {metrics.winRate.toFixed(1)}% won ·{" "}
        {metrics.profitFactor === null
          ? "no losses"
          : `PF ${metrics.profitFactor.toFixed(2)}`}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        max drawdown {metrics.maxDrawdown.toFixed(1)} · costs{" "}
        {metrics.costPoints.toFixed(1)}
      </p>
    </div>
  );
}

function CandidateCard({
  candidate,
  runId,
  onAdopted,
}: {
  candidate: DiscoveryCandidate;
  runId: string;
  onAdopted: () => void;
}) {
  const [adopting, setAdopting] = useState(false);
  const qualified = candidate.verdict === "qualified";

  const adopt = async () => {
    setAdopting(true);
    try {
      const { assetId, added } = await api.adoptStrategy(runId);
      toast.success(
        added
          ? `Added ${assetId} with this strategy. Enable it in Settings when you are ready to trade it.`
          : `Applied to ${assetId}. It takes effect on the next signal run.`,
      );
      onAdopted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply");
    } finally {
      setAdopting(false);
    }
  };

  return (
    <Card className={qualified ? "border-emerald-600/40" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-sm flex items-center gap-2">
              {qualified ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <XCircle className="h-4 w-4 text-muted-foreground" />
              )}
              {VERDICT_LABEL[candidate.verdict]}
            </CardTitle>
            <CardDescription className="max-w-3xl">
              {candidate.summary}
            </CardDescription>
          </div>
          {qualified && (
            <Button size="sm" onClick={adopt} disabled={adopting}>
              {adopting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Use this strategy
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricsColumn
            title="Training"
            subtitle="Chosen here, so these numbers are flattering by construction."
            metrics={candidate.train}
          />
          <MetricsColumn
            title="Validation"
            subtitle="Filtered here. Partly spent by the act of choosing."
            metrics={candidate.validation}
          />
          <MetricsColumn
            title="Test"
            subtitle="Never seen during the search. This is the estimate to believe."
            metrics={candidate.test}
            emphasis
          />
        </div>

        <div className="text-xs text-muted-foreground">
          p = {candidate.adjustedPValue.toFixed(4)} after correcting for the
          number of configurations tried
          {candidate.overall.breakevenWinRate !== null && (
            <>
              {" "}
              · needs {candidate.overall.breakevenWinRate.toFixed(1)}% wins to
              cover costs
            </>
          )}
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Parameters
          </summary>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3 mt-2 font-mono">
            {Object.entries(candidate.config).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{k}</span>
                <span>{String(v)}</span>
              </div>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

/** camelCase → "Camel case" for a readable field label. */
function humanize(key: string): string {
  const s = key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
  return s.trim();
}

function ConfigEditor({
  config,
  onChange,
}: {
  config: StrategyConfig;
  onChange: (key: keyof StrategyConfig, value: number) => void;
}) {
  return (
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {(Object.keys(config) as Array<keyof StrategyConfig>).map(key => (
        <div key={key} className="flex items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground truncate" title={key}>
            {humanize(key)}
          </Label>
          <Input
            type="number"
            step="any"
            value={config[key]}
            onChange={e => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(key, n);
            }}
            className="h-7 w-24 text-xs font-mono"
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Bring-your-own-history: upload a CSV for any pair, backtest the strategy on
 * it, tune the parameters, re-backtest, and apply the tuned config to the
 * engine. This is the manual counterpart to the automatic search below — you
 * supply the data and the idea, it scores and installs it.
 */
function UploadBacktest() {
  const defaults = useLive(() => api.defaultConfig(), []);
  const templateConfig = defaults?.assets[0]?.config ?? null;

  const [symbol, setSymbol] = useState("");
  const [interval, setInterval] = useState("15m");
  const [precision, setPrecision] = useState(2);
  const [config, setConfig] = useState<StrategyConfig | null>(null);
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [busy, setBusy] = useState<"upload" | "run" | "apply" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileText, setFileText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");

  // Seed the editable config from the shipped defaults once they load.
  const activeConfig = config ?? templateConfig;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setFileText(await file.text());
    // Guess the symbol from the filename if the box is empty (e.g. EURUSD_M15.csv).
    if (!symbol) {
      const guess = file.name.replace(/\.[^.]+$/, "").split(/[_.-]/)[0];
      if (guess) setSymbol(guess.toUpperCase());
    }
  };

  const uploadAndRun = async () => {
    if (!fileText) {
      toast.error("Choose a CSV file first.");
      return;
    }
    if (!symbol.trim()) {
      toast.error("Enter a symbol name for this data.");
      return;
    }
    if (!activeConfig) return;
    setBusy("upload");
    try {
      const up = await api.uploadBacktestCsv(symbol.trim(), interval, fileText);
      setUploaded(up);
      const cfg = config ?? templateConfig;
      if (cfg && !config) setConfig({ ...cfg });
      const res = await api.runBacktest({
        assetId: up.assetId,
        interval: up.interval,
        config: cfg ?? activeConfig,
        precision,
      });
      setResult(res);
      toast.success(
        `Parsed ${up.bars} bars${up.skipped ? ` (${up.skipped} skipped)` : ""} and backtested.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const rerun = async () => {
    if (!uploaded || !activeConfig) return;
    setBusy("run");
    try {
      const res = await api.runBacktest({
        assetId: uploaded.assetId,
        interval: uploaded.interval,
        config: activeConfig,
        precision,
      });
      setResult(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!uploaded || !activeConfig) return;
    setBusy("apply");
    try {
      const { assetId, added } = await api.applyStrategy({
        symbol: uploaded.symbol,
        config: activeConfig,
        precision,
        interval: uploaded.interval,
      });
      toast.success(
        added
          ? `Added ${assetId} to the engine (disabled). Enable it in Settings and point MT5 at ${assetId} to trade it.`
          : `Updated ${assetId}'s strategy. It takes effect on the next signal run.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Backtest your own file
        </CardTitle>
        <CardDescription>
          Upload an OHLC CSV for any pair (MetaTrader, TradingView and Dukascopy
          exports all work). It backtests with the default strategy, then you
          can tune the parameters and apply the result to the engine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload row */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label className="text-xs font-medium">CSV file</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv"
              onChange={e => void onFile(e.target.files?.[0])}
              className="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:text-foreground"
            />
            {fileName && (
              <p className="text-[11px] text-muted-foreground truncate">
                {fileName}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Symbol</Label>
            <Input
              value={symbol}
              placeholder="e.g. EURUSD"
              onChange={e => setSymbol(e.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Timeframe</Label>
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map(i => (
                  <SelectItem key={i} value={i}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Price decimals</Label>
            <Input
              type="number"
              min={0}
              max={8}
              value={precision}
              onChange={e => setPrecision(Number(e.target.value))}
            />
          </div>
        </div>

        <Button
          onClick={uploadAndRun}
          disabled={busy !== null || !activeConfig}
        >
          {busy === "upload" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Upload & backtest
        </Button>

        {/* Results */}
        {result && uploaded && (
          <div className="space-y-3 pt-1">
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {uploaded.symbol} {uploaded.interval} · {result.bars} bars
              </p>
              <p className="text-xs text-muted-foreground">
                {toDateInput(result.from)} → {toDateInput(result.to)}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricsColumn
                title="Backtest result"
                subtitle="The tuned strategy over the whole uploaded history, costs included."
                metrics={result.metrics}
                emphasis
              />
              <div className="rounded-lg border p-3 space-y-1 text-xs text-muted-foreground">
                <p>
                  Expectancy{" "}
                  <span className="text-foreground font-mono">
                    {result.metrics.expectancyPerTrade.toFixed(2)}
                  </span>{" "}
                  pts/trade
                </p>
                <p>
                  Break-even win rate{" "}
                  <span className="text-foreground font-mono">
                    {result.metrics.breakevenWinRate === null
                      ? "—"
                      : `${result.metrics.breakevenWinRate.toFixed(1)}%`}
                  </span>
                </p>
                <p className="pt-1 leading-snug">
                  One pass over all the data — this is not the three-way,
                  overfitting-guarded split the automatic search does below.
                  Treat a great number here with suspicion.
                </p>
              </div>
            </div>

            {/* Tuning */}
            {activeConfig && (
              <details open className="text-sm">
                <summary className="cursor-pointer font-medium">
                  Tune parameters
                </summary>
                <div className="mt-3 space-y-3">
                  <ConfigEditor
                    config={activeConfig}
                    onChange={(key, value) =>
                      setConfig(prev => ({
                        ...(prev ?? activeConfig),
                        [key]: value,
                      }))
                    }
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={rerun}
                      disabled={busy !== null}
                    >
                      {busy === "run" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      Re-run backtest
                    </Button>
                    {templateConfig && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfig({ ...templateConfig })}
                        disabled={busy !== null}
                      >
                        Reset to defaults
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={apply}
                      disabled={busy !== null}
                      className="ml-auto"
                    >
                      {busy === "apply" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Apply to engine
                    </Button>
                  </div>
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ResearchPage() {
  const [symbol, setSymbol] = useState("NAS100");
  const [interval, setIntervalValue] = useState("15m");
  const [from, setFrom] = useState("2024-01-01");
  const [to, setTo] = useState(toDateInput(Math.floor(Date.now() / 1000)));
  const [iterations, setIterations] = useState(500);
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Polled rather than pushed over the event stream. A run reports progress
  // continuously for minutes, and broadcasting each tick to every connected tab
  // would flood a channel the rest of the app shares for meaningful changes.
  const poll = useCallback(async (id: string) => {
    try {
      const latest = await api.research(id);
      setRun(latest);
      if (
        latest.status === "requesting" ||
        latest.status === "downloading" ||
        latest.status === "searching"
      ) {
        pollRef.current = setTimeout(() => void poll(id), 1000);
      }
    } catch {
      pollRef.current = setTimeout(() => void poll(id), 3000);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const start = async () => {
    const fromSec = toSeconds(from);
    const toSec = toSeconds(to);
    if (
      !Number.isFinite(fromSec) ||
      !Number.isFinite(toSec) ||
      toSec <= fromSec
    ) {
      toast.error("The end date must be after the start date.");
      return;
    }
    setStarting(true);
    try {
      const started = await api.startResearch({
        symbol: symbol.trim(),
        interval,
        from: fromSec,
        to: toSec,
        iterations,
      });
      setRun(started);
      void poll(started.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the run");
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    try {
      await api.cancelResearch(run.id);
      toast.info("Stopping after the current batch.");
    } catch (e) {
      // Runs live in memory, so a server restart forgets them. The tab that was
      // watching one still shows a Stop button; pressing it must explain that
      // rather than throw into the void.
      toast.error(
        e instanceof ApiError && e.status === 404
          ? "That run is gone — the server restarted while it was going."
          : "Could not stop the run.",
      );
    }
  };

  const active =
    run?.status === "requesting" ||
    run?.status === "downloading" ||
    run?.status === "searching";

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Strategy discovery
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick an instrument and a period. The app pulls the history from your
          MetaTrader 5 terminal and searches for a strategy that survives data
          it never saw.
        </p>
      </div>

      <UploadBacktest />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What to search</CardTitle>
          <CardDescription>
            Use the symbol exactly as your broker spells it. Two years of 15m
            bars is about 50,000 — enough for a three-way split to mean
            something.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Instrument</Label>
              <Input
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                list="common-symbols"
              />
              <datalist id="common-symbols">
                {COMMON_SYMBOLS.map(s => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Timeframe</Label>
              <Select value={interval} onValueChange={setIntervalValue}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVALS.map(i => (
                    <SelectItem key={i} value={i}>
                      {i}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">From</Label>
              <Input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">To</Label>
              <Input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Configurations</Label>
              <Input
                type="number"
                min={10}
                max={20000}
                step={100}
                value={iterations}
                onChange={e => setIterations(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground leading-snug">
                More is not better: every extra attempt raises the bar the
                winner must clear.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={start} disabled={starting || active}>
              {starting || active ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Find a strategy
            </Button>
            {active && (
              <Button variant="outline" onClick={cancel}>
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {run && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {run.symbol} {run.interval}
              <Badge variant="outline" className="text-[10px]">
                {run.status}
              </Badge>
            </CardTitle>
            <CardDescription>{run.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {active && <Progress value={run.progress * 100} />}

            {run.error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>{run.error}</p>
              </div>
            )}

            {run.report && (
              <>
                <Separator />
                <div className="grid gap-2 sm:grid-cols-4 text-xs">
                  <div>
                    <p className="text-muted-foreground">Bars</p>
                    <p className="font-medium tabular-nums">
                      {run.report.bars}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Split</p>
                    <p className="font-medium tabular-nums">
                      {run.report.split.train} / {run.report.split.validation} /{" "}
                      {run.report.split.test}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Tried</p>
                    <p className="font-medium tabular-nums">
                      {run.report.iterations}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Seed</p>
                    <p className="font-medium tabular-nums">
                      {run.report.seed}
                    </p>
                  </div>
                </div>
                <p className="text-sm">{run.report.conclusion}</p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {run?.report?.best && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Best surviving strategy</h2>
          <CandidateCard
            candidate={run.report.best}
            runId={run.id}
            onAdopted={() => void poll(run.id)}
          />
        </div>
      )}

      {run?.report && run.report.candidates.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">
            Everything else the search looked at
          </h2>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Verdict</TableHead>
                    <TableHead className="text-right">Train</TableHead>
                    <TableHead className="text-right">Validation</TableHead>
                    <TableHead className="text-right">Test</TableHead>
                    <TableHead className="text-right">p</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.report.candidates.map((c, i) => (
                    <TableRow key={`${c.verdict}-${i}`}>
                      <TableCell className="text-xs">
                        {VERDICT_LABEL[c.verdict]}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {c.train.netPoints.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {c.validation.trades === 0
                          ? "—"
                          : c.validation.netPoints.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {c.test.trades === 0
                          ? "—"
                          : c.test.netPoints.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {c.adjustedPValue >= 1
                          ? "—"
                          : c.adjustedPValue.toFixed(3)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default ResearchPage;
