/**
 * Charts Panel — a build-your-own wall of TradingView charts.
 *
 * Add as many charts as you like, each on any TradingView symbol, then choose
 * the column count, the row height, and how many columns each chart spans.
 * Presets lay out common arrangements in one click. The whole layout is saved
 * to localStorage, so the wall you build is still there next time.
 */

import { LayoutGrid, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TradingViewChart } from "@/components/charts/TradingViewChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLive } from "@/hooks/useLive";
import { api } from "@/lib/api";

interface ChartCfg {
  id: string;
  symbol: string;
  interval: string;
  /** Columns this chart spans in the grid. */
  span: number;
}

interface PanelState {
  columns: number;
  rowHeight: number;
  charts: ChartCfg[];
}

const STORAGE_KEY = "xau-charts-panel-v1";

const INTERVALS: Array<{ value: string; label: string }> = [
  { value: "1", label: "1m" },
  { value: "3", label: "3m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
  { value: "240", label: "4h" },
  { value: "D", label: "1D" },
  { value: "W", label: "1W" },
];

const ROW_HEIGHTS: Array<{ value: number; label: string }> = [
  { value: 280, label: "S" },
  { value: 400, label: "M" },
  { value: 560, label: "L" },
  { value: 760, label: "XL" },
];

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const chart = (symbol: string, interval = "60", span = 1): ChartCfg => ({
  id: newId(),
  symbol,
  interval,
  span,
});

/** One-click arrangements. */
const PRESETS: Array<{ name: string; make: () => PanelState }> = [
  {
    name: "Single",
    make: () => ({
      columns: 1,
      rowHeight: 560,
      charts: [chart("OANDA:XAUUSD", "60")],
    }),
  },
  {
    name: "Duo",
    make: () => ({
      columns: 2,
      rowHeight: 460,
      charts: [chart("OANDA:XAUUSD", "60"), chart("BINANCE:BTCUSDT", "60")],
    }),
  },
  {
    name: "Quad 2×2",
    make: () => ({
      columns: 2,
      rowHeight: 400,
      charts: [
        chart("OANDA:XAUUSD", "15"),
        chart("BINANCE:BTCUSDT", "15"),
        chart("BINANCE:ETHUSDT", "15"),
        chart("BINANCE:BNBUSDT", "15"),
      ],
    }),
  },
  {
    name: "Six 3×2",
    make: () => ({
      columns: 3,
      rowHeight: 340,
      charts: [
        chart("OANDA:XAUUSD", "15"),
        chart("BINANCE:BTCUSDT", "15"),
        chart("BINANCE:ETHUSDT", "15"),
        chart("BINANCE:BNBUSDT", "15"),
        chart("BINANCE:LINKUSDT", "15"),
        chart("BINANCE:AAVEUSDT", "15"),
      ],
    }),
  },
  {
    name: "Gold focus",
    make: () => ({
      columns: 3,
      rowHeight: 420,
      // A wide primary chart with two smaller context charts beside it.
      charts: [
        chart("OANDA:XAUUSD", "60", 2),
        chart("OANDA:XAUUSD", "240", 1),
        chart("TVC:DXY", "60", 1),
        chart("TVC:US10Y", "60", 1),
      ],
    }),
  },
];

function loadState(): PanelState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PanelState;
      if (Array.isArray(parsed.charts)) return parsed;
    }
  } catch {
    // fall through to default
  }
  return PRESETS[2].make(); // Quad by default
}

/** Map the app's configured assets to TradingView symbols for quick-add. */
function useAssetQuickAdd(): Array<{ label: string; tv: string }> {
  const data = useLive(() => api.assets(), ["config"]);
  const assets = (data?.assets ?? []).filter(a => a.dataSource === "binance");
  return assets.map(a => ({
    label: a.symbol,
    // Gold trades better on OANDA's continuous feed than the Binance proxy.
    tv: a.id === "PAXGUSDT" ? "OANDA:XAUUSD" : `BINANCE:${a.id.toUpperCase()}`,
  }));
}

export function ChartsPanelPage() {
  const [state, setState] = useState<PanelState>(loadState);
  const [symbolInput, setSymbolInput] = useState("");
  const [addInterval, setAddInterval] = useState("60");
  const quickAdd = useAssetQuickAdd();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or blocked — layout just won't persist
    }
  }, [state]);

  const setColumns = (columns: number) => setState(s => ({ ...s, columns }));
  const setRowHeight = (rowHeight: number) =>
    setState(s => ({ ...s, rowHeight }));

  const addChart = useCallback((symbol: string, interval: string) => {
    const clean = symbol.trim().toUpperCase();
    if (!clean) return;
    setState(s => ({ ...s, charts: [...s.charts, chart(clean, interval)] }));
  }, []);

  const removeChart = (id: string) =>
    setState(s => ({ ...s, charts: s.charts.filter(c => c.id !== id) }));

  const setChartInterval = (id: string, interval: string) =>
    setState(s => ({
      ...s,
      charts: s.charts.map(c => (c.id === id ? { ...c, interval } : c)),
    }));

  const setChartSpan = (id: string, delta: number) =>
    setState(s => ({
      ...s,
      charts: s.charts.map(c =>
        c.id === id
          ? { ...c, span: Math.max(1, Math.min(s.columns, c.span + delta)) }
          : c,
      ),
    }));

  const gridStyle = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: `repeat(${state.columns}, minmax(0, 1fr))`,
      gap: "0.75rem",
    }),
    [state.columns],
  );

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4 w-full">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#26A69A] to-[#1B7A70] flex items-center justify-center">
            <LayoutGrid className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Charts Panel</h1>
            <p className="text-[11px] text-muted-foreground">
              Your own wall of TradingView charts — any symbol, any many.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          {/* Columns */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">
              Cols
            </span>
            {[1, 2, 3, 4].map(n => (
              <button
                type="button"
                key={n}
                onClick={() => setColumns(n)}
                className={`w-7 h-7 rounded-md text-xs font-mono font-bold border ${
                  state.columns === n
                    ? "bg-[#26A69A] text-white border-[#26A69A]"
                    : "text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Row height */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">
              Size
            </span>
            {ROW_HEIGHTS.map(h => (
              <button
                type="button"
                key={h.value}
                onClick={() => setRowHeight(h.value)}
                className={`w-7 h-7 rounded-md text-xs font-mono font-bold border ${
                  state.rowHeight === h.value
                    ? "bg-[#26A69A] text-white border-[#26A69A]"
                    : "text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Presets
        </span>
        {PRESETS.map(p => (
          <button
            type="button"
            key={p.name}
            onClick={() => setState(p.make())}
            className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-[#26A69A]/40 transition-colors"
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Add chart */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <form
          className="flex items-center gap-2 flex-wrap"
          onSubmit={e => {
            e.preventDefault();
            addChart(symbolInput, addInterval);
            setSymbolInput("");
          }}
        >
          <Input
            value={symbolInput}
            onChange={e => setSymbolInput(e.target.value)}
            placeholder="Symbol e.g. BINANCE:BTCUSDT, NASDAQ:AAPL"
            className="h-8 w-64 font-mono text-xs"
          />
          <select
            value={addInterval}
            onChange={e => setAddInterval(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs font-mono"
          >
            {INTERVALS.map(iv => (
              <option key={iv.value} value={iv.value}>
                {iv.label}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" className="h-8">
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </form>

        {quickAdd.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap sm:ml-2 sm:border-l sm:border-border sm:pl-3">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Quick add
            </span>
            {quickAdd.map(q => (
              <button
                type="button"
                key={q.tv}
                onClick={() => addChart(q.tv, addInterval)}
                className="px-2 py-0.5 rounded text-[11px] font-mono bg-secondary/50 text-muted-foreground hover:text-foreground"
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The wall */}
      {state.charts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-2 rounded-xl border border-dashed border-border text-muted-foreground">
          <LayoutGrid className="h-8 w-8 opacity-40" />
          <p className="text-sm">
            No charts yet — add one above or pick a preset.
          </p>
        </div>
      ) : (
        <div style={gridStyle}>
          {state.charts.map(c => (
            <div
              key={c.id}
              className="rounded-xl border border-border bg-card overflow-hidden flex flex-col"
              style={{
                gridColumn: `span ${Math.min(c.span, state.columns)}`,
                height: state.rowHeight,
              }}
            >
              {/* Chart toolbar */}
              <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border shrink-0">
                <span className="text-xs font-mono font-bold truncate">
                  {c.symbol}
                </span>
                <div className="flex items-center gap-1.5 ml-auto">
                  <select
                    value={c.interval}
                    onChange={e => setChartInterval(c.id, e.target.value)}
                    className="h-6 rounded border border-border bg-background px-1 text-[11px] font-mono"
                  >
                    {INTERVALS.map(iv => (
                      <option key={iv.value} value={iv.value}>
                        {iv.label}
                      </option>
                    ))}
                  </select>
                  {/* Width span controls */}
                  <div className="flex items-center rounded border border-border">
                    <button
                      type="button"
                      onClick={() => setChartSpan(c.id, -1)}
                      disabled={c.span <= 1}
                      className="w-6 h-6 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                      title="Narrower"
                    >
                      −
                    </button>
                    <span className="text-[10px] font-mono text-muted-foreground w-4 text-center">
                      {Math.min(c.span, state.columns)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setChartSpan(c.id, 1)}
                      disabled={c.span >= state.columns}
                      className="w-6 h-6 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                      title="Wider"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeChart(c.id)}
                    className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-[#FF1744]"
                    title="Remove chart"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {/* The widget */}
              <div className="flex-1 min-h-0">
                <TradingViewChart symbol={c.symbol} interval={c.interval} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
