/**
 * Stream an MT5 tick export into 5-minute OHLCV candles, and measure the real
 * bid/ask spread across the whole file.
 *
 * The export is tab-separated `DATE TIME BID ASK LAST VOLUME FLAGS`, one row
 * per tick, and can run into the gigabytes — far too large to read whole. This
 * reads it one line at a time via node:readline over a file stream, so peak
 * memory is bounded by the candle count, not the file size.
 *
 * Timestamps have no explicit timezone in the export; they are treated as UTC.
 * If the broker's server clock differs from UTC, 5-minute bar boundaries shift
 * by that offset, but the shape of the resampled series does not change.
 *
 * `volume` on the output candles is the tick count per bucket, not a traded
 * size — MT5 tick exports carry no real volume field for FX/CFD symbols
 * (LAST/VOLUME are blank). core/strategy.ts never reads volume when scoring a
 * signal, so this is cosmetic only.
 *
 * Usage:
 *   bun run --bun scripts/tick-to-candles.ts
 *   bun run --bun scripts/tick-to-candles.ts --file /path/to/ticks.csv --out tmp/xauusd_5m.json
 */

import { createReadStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { Candle } from "../core/strategy";

export interface TickCandleOutput {
  candles: Candle[];
  /** Mean (ask - bid) / mid across every tick, in basis points. */
  meanSpreadBps: number;
  tickCount: number;
  candleIntervalSec: number;
  from: string;
  to: string;
}

const DEFAULT_FILE = `${
  process.env.HOME
}/Downloads/XAUUSD_202601020100_202607312354.csv`;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : undefined;
}

/** "2026.01.02" + "01:00:00.484" → epoch seconds, treated as UTC. */
function parseEpochSec(date: string, time: string): number | null {
  const d = date.split(".");
  const t = time.split(":");
  if (d.length !== 3 || t.length !== 3) return null;
  const [y, mo, day] = d;
  const [hh, mm, ssRaw] = t;
  const ss = ssRaw.split(".")[0];
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(day),
    Number(hh),
    Number(mm),
    Number(ss),
  );
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

interface Bucket {
  bucket: number;
  open: number;
  high: number;
  low: number;
  close: number;
  ticks: number;
}

async function main() {
  const file = flag("file") ?? DEFAULT_FILE;
  const out = flag("out") ?? "tmp/xauusd_5m.json";
  const intervalSec = Number.parseInt(flag("interval") ?? "300", 10);

  console.log(`\nStreaming ${file}\n`);

  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  const candles: Candle[] = [];
  let cur: Bucket | null = null;
  let tickCount = 0;
  let skipped = 0;
  let spreadSumBps = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let isHeader = true;
  // MT5 exports often carry one-sided quote updates (FLAGS bid-only or
  // ask-only, the other column left blank). Forward-filling the stale side
  // instead of dropping the tick uses ~100% of the stream rather than only
  // the ~86% of ticks that update both sides at once, and captures
  // intra-bucket high/low touches the two-sided-only ticks would miss.
  let lastBid = 0;
  let lastAsk = 0;

  const flush = () => {
    if (!cur) return;
    candles.push({
      time: cur.bucket,
      open: cur.open,
      high: cur.high,
      low: cur.low,
      close: cur.close,
      volume: cur.ticks,
    });
  };

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    if (!line) continue;

    const fields = line.split("\t");
    if (fields.length < 4) {
      skipped++;
      continue;
    }
    const [date, time, bidStr, askStr] = fields;
    const bidRaw = Number.parseFloat(bidStr);
    const askRaw = Number.parseFloat(askStr);
    if (Number.isFinite(bidRaw) && bidRaw > 0) lastBid = bidRaw;
    if (Number.isFinite(askRaw) && askRaw > 0) lastAsk = askRaw;
    if (lastBid <= 0 || lastAsk <= 0) {
      // No two-sided quote seen yet (start of file) — nothing to bucket.
      skipped++;
      continue;
    }
    const bid = lastBid;
    const ask = lastAsk;
    const ts = parseEpochSec(date, time);
    if (ts === null) {
      skipped++;
      continue;
    }

    const mid = (bid + ask) / 2;
    spreadSumBps += ((ask - bid) / mid) * 10_000;
    tickCount++;
    if (firstTs === null) firstTs = ts;
    lastTs = ts;

    const bucket = Math.floor(ts / intervalSec) * intervalSec;
    if (!cur || cur.bucket !== bucket) {
      flush();
      cur = { bucket, open: mid, high: mid, low: mid, close: mid, ticks: 1 };
    } else {
      if (mid > cur.high) cur.high = mid;
      if (mid < cur.low) cur.low = mid;
      cur.close = mid;
      cur.ticks++;
    }

    if (tickCount % 10_000_000 === 0) {
      console.log(`  ${tickCount / 1_000_000}M ticks processed…`);
    }
  }
  flush();

  if (tickCount === 0) {
    console.error("No usable ticks parsed — check the file format.");
    process.exit(1);
  }

  const result: TickCandleOutput = {
    candles,
    meanSpreadBps: spreadSumBps / tickCount,
    tickCount,
    candleIntervalSec: intervalSec,
    from: new Date((firstTs ?? 0) * 1000).toISOString(),
    to: new Date((lastTs ?? 0) * 1000).toISOString(),
  };

  mkdirSync(dirname(out), { recursive: true });
  await Bun.write(out, JSON.stringify(result));

  console.log(
    `\nTicks:         ${tickCount.toLocaleString()} (${skipped.toLocaleString()} skipped)`,
  );
  console.log(
    `Candles (${intervalSec}s): ${candles.length.toLocaleString()}`,
  );
  console.log(`Range:         ${result.from} → ${result.to}`);
  console.log(`Mean spread:   ${result.meanSpreadBps.toFixed(3)} bps`);
  console.log(`Written to:    ${out}\n`);
}

main().catch(err => {
  console.error("tick-to-candles error:", err);
  process.exit(1);
});
