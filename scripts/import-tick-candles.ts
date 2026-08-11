/**
 * Load the JSON produced by tick-to-candles.ts into the candle DB, and register
 * the MEASURED tick-level spread as the asset's cost model.
 *
 * This closes the loop: the 5m candles resampled from ticks become queryable by
 * edgescan/backtest under MT5:XAUUSD, and — crucially — the spread those tools
 * charge is the mean bid/ask measured across every tick in the file, not a
 * guess. Cost is the first-order variable at fine timeframes, so measuring it
 * from the same ticks that formed the bars is the honest way to price a 5m edge.
 *
 * Usage:
 *   bun run --bun scripts/import-tick-candles.ts [--in tmp/xauusd_5m.json] [--asset XAUUSD] [--interval 5m]
 */

import { readFileSync } from "node:fs";
import { db as openDb } from "../server/db";
import type { TickCandleOutput } from "./tick-to-candles";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : undefined;
}

function intervalFromSec(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}

function main() {
  const inFile = flag("in") ?? "tmp/xauusd_5m.json";
  const asset = flag("asset") ?? "XAUUSD";
  const parsed = JSON.parse(readFileSync(inFile, "utf-8")) as TickCandleOutput;

  const interval = flag("interval") ?? intervalFromSec(parsed.candleIntervalSec);
  const assetId = `MT5:${asset}`;
  const database = openDb();

  if (!parsed.candles?.length) {
    console.error(`No candles in ${inFile}`);
    process.exit(1);
  }

  database.saveCandles(assetId, interval, parsed.candles);

  // Register / refresh the metadata with the MEASURED spread. Overwrites any
  // prior guess so edgescan/backtest charge the real cost from this file.
  const digits = asset.includes("JPY") ? 3 : 2;
  const existing = database.getSetting<Record<string, unknown>>(`mt5:${asset}`);
  database.setSetting(`mt5:${asset}`, {
    ...(existing ?? {}),
    symbol: asset,
    digits,
    assetId,
    spreadBps: parsed.meanSpreadBps,
  });

  console.log(
    `${inFile}: ${parsed.candles.length.toLocaleString()} ${interval} bars → ${assetId}\n` +
      `  range ${parsed.from.slice(0, 10)} → ${parsed.to.slice(0, 10)}\n` +
      `  measured spread ${parsed.meanSpreadBps.toFixed(3)} bps ` +
      `(from ${parsed.tickCount.toLocaleString()} ticks) → registered as cost model`,
  );
}

main();
