/**
 * Quiet-trend with a DAILY-trend veto, compared head-to-head against the
 * unfiltered quiet-trend baseline.
 *
 * The edgescan showed that the "with vs against the Daily trend" gap grows with
 * timeframe and is the most consistent signal in the dataset. quiet-trend
 * already gates on H1 volatility; this asks whether ALSO vetoing entries that
 * disagree with the Daily EMA(50) trend improves the real-exit backtest.
 *
 * No lookahead: at each H1 bar the Daily regime is read from daily candles that
 * CLOSED strictly before the current UTC day, so the in-progress day never
 * informs its own entries.
 *
 * Usage:
 *   bun run scripts/quiet-trend-daily-bt.ts [--ema 50] [--buffer 0.0005]
 */

import { mt5Asset } from "../core/assets";
import { type CostModel, entryCost, exitCost } from "../core/costs";
import type { Candle, Direction } from "../core/strategy";
import { calcEMA } from "../core/strategy";
import { db as openDb } from "../server/db";

interface Trade {
  dir: Direction;
  net: number;
  barsHeld: number;
}

// ─── Daily regime (built from H1, read without lookahead) ────────────────────

/** UTC day index (days since epoch) for a unix-seconds timestamp. */
function dayKey(timeSec: number): number {
  return Math.floor(timeSec / 86400);
}

/** Aggregate H1 candles into daily OHLC bars keyed by UTC day. */
function buildDailyBars(h1: Candle[]): { day: number; close: number }[] {
  const byDay = new Map<number, Candle>();
  for (const c of h1) {
    const d = dayKey(c.time);
    const cur = byDay.get(d);
    if (!cur) {
      byDay.set(d, { ...c });
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close; // last H1 close of the day
    }
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, c]) => ({ day, close: c.close }));
}

/**
 * Map each UTC day → the Daily EMA-trend direction computed from days that
 * closed strictly BEFORE it. Returns LONG / SHORT / null(neutral).
 */
function dailyRegimeByDay(
  daily: { day: number; close: number }[],
  emaPeriod: number,
  buffer: number,
): Map<number, Direction | null> {
  const closes = daily.map(d => d.close);
  const ema = calcEMA(closes, emaPeriod);
  const out = new Map<number, Direction | null>();
  for (let k = 0; k < daily.length; k++) {
    // Regime available ON day daily[k+1] uses EMA + close through day k.
    const e = ema[k];
    if (e === undefined) continue;
    const price = closes[k];
    const buf = price * buffer;
    let dir: Direction | null = null;
    if (price > e + buf) dir = "LONG";
    else if (price < e - buf) dir = "SHORT";
    if (k + 1 < daily.length) out.set(daily[k + 1].day, dir);
  }
  return out;
}

// ─── quiet-trend signal (same as scripts/quiet-trend-bt.ts) ──────────────────

function meanAbsMove(candles: Candle[], i: number, n: number): number {
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++)
    sum += Math.abs(candles[k].close - candles[k - 1].close);
  return sum / n;
}

function atr(candles: Candle[], i: number, period: number): number {
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) {
    const tr = Math.max(
      candles[k].high - candles[k].low,
      Math.abs(candles[k].high - candles[k - 1].close),
      Math.abs(candles[k].low - candles[k - 1].close),
    );
    sum += tr;
  }
  return sum / period;
}

function signal(candles: Candle[], i: number): Direction | null {
  if (i < 120) return null;
  const vol = meanAbsMove(candles, i, 14);
  const recent: number[] = [];
  for (let k = i - 99; k <= i; k += 5) recent.push(meanAbsMove(candles, k, 14));
  recent.sort((a, b) => a - b);
  const cut = recent[Math.floor((recent.length * 50) / 100)];
  if (vol > cut) return null;
  const fast = candles.slice(i - 8, i + 1).reduce((s, c) => s + c.close, 0) / 9;
  const slow = candles.slice(i - 20, i + 1).reduce((s, c) => s + c.close, 0) / 21;
  if (fast === slow) return null;
  return fast > slow ? "LONG" : "SHORT";
}

function backtest(
  candles: Candle[],
  costs: CostModel,
  opts: {
    atrSl: number;
    tpR: number;
    maxBars: number;
    dailyVeto?: Map<number, Direction | null>;
  },
): { trades: Trade[]; vetoed: number } {
  const trades: Trade[] = [];
  let vetoed = 0;
  let i = 120;

  while (i < candles.length - 1) {
    const dir = signal(candles, i);
    if (dir === null) {
      i++;
      continue;
    }

    // Daily-trend veto: block entries that disagree with the Daily regime.
    if (opts.dailyVeto) {
      const regime = opts.dailyVeto.get(dayKey(candles[i].time));
      if (regime != null && regime !== dir) {
        vetoed++;
        i++;
        continue;
      }
    }

    const entryPrice = candles[i].close;
    const currentAtr = atr(candles, i, 14);
    const slDist = opts.atrSl * currentAtr;
    const tpDist = opts.tpR * slDist;
    const slPrice = dir === "LONG" ? entryPrice - slDist : entryPrice + slDist;
    const tpPrice = dir === "LONG" ? entryPrice + tpDist : entryPrice - tpDist;

    let exitPrice = 0;
    let exitKind: "TP" | "SL" | "TIME" = "TIME";
    let barsHeld = 0;

    for (let j = i + 1; j < Math.min(i + opts.maxBars + 1, candles.length); j++) {
      barsHeld = j - i;
      const bar = candles[j];
      if (dir === "LONG") {
        if (bar.low <= slPrice) { exitPrice = slPrice; exitKind = "SL"; break; }
        if (bar.high >= tpPrice) { exitPrice = tpPrice; exitKind = "TP"; break; }
      } else {
        if (bar.high >= slPrice) { exitPrice = slPrice; exitKind = "SL"; break; }
        if (bar.low <= tpPrice) { exitPrice = tpPrice; exitKind = "TP"; break; }
      }
    }
    if (exitKind === "TIME") {
      const lastBar = Math.min(i + opts.maxBars, candles.length - 1);
      exitPrice = candles[lastBar].close;
      barsHeld = lastBar - i;
    }

    const gross = dir === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice;
    const net =
      gross -
      entryCost(entryPrice, costs) -
      exitCost(exitPrice, exitKind === "TP" ? "TP" : "TRAIL_SL", costs);
    trades.push({ dir, net, barsHeld });
    i += Math.max(barsHeld, 1);
  }
  return { trades, vetoed };
}

function summarize(trades: Trade[], label: string, vetoed?: number) {
  if (trades.length === 0) {
    console.log(`${label}: no trades`);
    return;
  }
  const wins = trades.filter(t => t.net > 0);
  const losses = trades.filter(t => t.net <= 0);
  const winRate = (wins.length / trades.length) * 100;
  const total = trades.reduce((s, t) => s + t.net, 0);
  const avgWin = wins.reduce((s, t) => s + t.net, 0) / (wins.length || 1);
  const avgLoss = Math.abs(losses.reduce((s, t) => s + t.net, 0) / (losses.length || 1));
  const expectancy = total / trades.length;
  const grossWin = wins.reduce((s, t) => s + t.net, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.net, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : Infinity;

  let maxDD = 0, peak = 0, equity = 0;
  for (const t of trades) {
    equity += t.net;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;
  }
  const windowSize = Math.floor(trades.length / 6);
  let windowsPositive = 0;
  for (let w = 0; w < 6; w++) {
    const start = w * windowSize;
    const end = w === 5 ? trades.length : start + windowSize;
    if (trades.slice(start, end).reduce((s, t) => s + t.net, 0) > 0) windowsPositive++;
  }

  console.log(`\n${label}`);
  console.log(
    `  Trades: ${trades.length}   Win rate: ${winRate.toFixed(1)}%   ` +
      `PF: ${pf.toFixed(2)}   Windows +ve: ${windowsPositive}/6` +
      (vetoed != null ? `   (vetoed ${vetoed})` : ""),
  );
  console.log(
    `  Total P&L: ${total.toFixed(1)} pts   Expectancy: ${expectancy.toFixed(2)} pts/trade`,
  );
  console.log(
    `  Avg win: ${avgWin.toFixed(2)}   Avg loss: ${avgLoss.toFixed(2)}   ` +
      `Payoff: ${(avgWin / (avgLoss || 1)).toFixed(2)}R   Max DD: ${maxDD.toFixed(1)} pts`,
  );
}

function main() {
  const argv = process.argv.slice(2);
  const getArg = (k: string, d: number) => {
    const idx = argv.indexOf(`--${k}`);
    return idx >= 0 && argv[idx + 1] ? Number(argv[idx + 1]) : d;
  };
  const emaPeriod = getArg("ema", 50);
  const buffer = getArg("buffer", 0.0005);

  const database = openDb();
  const meta = database.getSetting<{
    symbol: string;
    digits: number;
    assetId: string;
    spreadBps: number;
  }>("mt5:XAUUSD");
  if (!meta) {
    console.error("No MT5 data. Run 'bun run mt5:import-h1' first.");
    process.exit(1);
  }

  const asset = mt5Asset(meta);
  const candles = database.getCandles(meta.assetId, "1h", 100_000);
  const daily = buildDailyBars(candles);
  const veto = dailyRegimeByDay(daily, emaPeriod, buffer);

  console.log(`Loaded ${candles.length} H1 bars → ${daily.length} daily bars`);
  console.log(
    `${new Date(candles[0].time * 1000).toISOString().slice(0, 10)} to ` +
      `${new Date(candles[candles.length - 1].time * 1000).toISOString().slice(0, 10)}`,
  );
  console.log(`Daily veto: EMA(${emaPeriod}) + ${(buffer * 100).toFixed(2)}% buffer\n`);

  const configs = [
    { atrSl: 1.5, tpR: 2.5, maxBars: 24, label: "1.5x ATR SL / 2.5R TP" },
    { atrSl: 2.0, tpR: 2.0, maxBars: 24, label: "2.0x ATR SL / 2.0R TP" },
  ];

  for (const cfg of configs) {
    console.log(`══════ ${cfg.label} ══════`);
    const base = backtest(candles, asset.costs, cfg);
    summarize(base.trades, "  BASELINE (H1 quiet-trend, no daily veto)");
    const filtered = backtest(candles, asset.costs, { ...cfg, dailyVeto: veto });
    summarize(filtered.trades, "  + DAILY-TREND VETO", filtered.vetoed);
  }
}

main();
