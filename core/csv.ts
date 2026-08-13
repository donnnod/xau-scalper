/**
 * Tolerant OHLC CSV parser for user-uploaded price files.
 *
 * Trading platforms disagree on nearly everything about a CSV export — the
 * delimiter (tab, comma or semicolon), whether there is a header, whether date
 * and time are one column or two, and how the date is punctuated. Rather than
 * demand one exact shape, this sniffs each of those and accepts the common
 * variants MT5, TradingView and Dukascopy produce.
 *
 * It is deliberately framework-free (no db, no Bun) so it can be unit-tested
 * and shared between the import script and the server.
 */

import type { Candle } from "./strategy";

/** A parsed file plus what had to be discarded, so the UI can be honest. */
export interface CsvParseResult {
  candles: Candle[];
  /** Rows that could not be read as a candle (bad numbers, unparseable date). */
  skipped: number;
}

const DELIMITERS = ["\t", ",", ";"];

/** Pick the delimiter that splits the first data-looking line into the most fields. */
function sniffDelimiter(lines: string[]): string {
  const sample = lines.find(l => l.trim().length > 0) ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const count = sample.split(d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Parse a date (and optional separate time) field into UTC seconds, or NaN. */
function parseTime(dateField: string, timeField?: string): number {
  let date = dateField.trim();
  const time = (timeField ?? "").trim();

  // MT5 punctuates dates with dots: 2024.01.31 → 2024-01-31.
  date = date.replace(/\./g, "-").replace(/\//g, "-");

  // A field that already carries its own time (e.g. "2024-01-31 09:30:00" or an
  // ISO string) is used whole; otherwise join the separate date and time.
  let iso: string;
  if (/[T ]\d{1,2}:\d{2}/.test(date)) {
    iso = date.replace(" ", "T");
  } else if (time) {
    iso = `${date}T${time}`;
  } else {
    iso = `${date}T00:00:00`;
  }

  // Treat a bare wall-clock timestamp as UTC; if it already has a zone, respect it.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) iso += "Z";

  const ms = Date.parse(iso);
  if (!Number.isNaN(ms)) return Math.floor(ms / 1000);

  // Fall back to a plain epoch number (seconds or milliseconds).
  const epoch = Number(dateField);
  if (Number.isFinite(epoch) && epoch > 0) {
    return epoch > 1e12 ? Math.floor(epoch / 1000) : Math.floor(epoch);
  }
  return Number.NaN;
}

const isNum = (s: string) => s !== "" && Number.isFinite(Number(s));

/**
 * Parse OHLC(V) rows from `text`.
 *
 * Accepts, per row, either:
 *   date, time, open, high, low, close[, volume]   (7/6 fields, MT5 style)
 *   datetime, open, high, low, close[, volume]     (6/5 fields)
 * Extra trailing columns (spread, real volume) are ignored.
 */
export function parseCandlesCsv(text: string): CsvParseResult {
  const rawLines = text.split(/\r?\n/);
  const delim = sniffDelimiter(rawLines);

  const candles: Candle[] = [];
  let skipped = 0;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Header rows: MT5 wraps names in <angle brackets>, others start with a
    // non-numeric first cell like "Date" or "time".
    const cells = trimmed.split(delim).map(c => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 5) {
      skipped++;
      continue;
    }
    if (trimmed.startsWith("<") || !/\d/.test(cells[0])) {
      // A header or comment line — silent, not counted as a bad data row.
      continue;
    }

    // Decide whether date and time are split across the first two columns.
    const hasSplitTime =
      !isNum(cells[0]) &&
      /^\d{1,2}:\d{2}/.test(cells[1] ?? "") &&
      cells.length >= 6;

    const o = hasSplitTime ? 2 : 1;
    const time = hasSplitTime
      ? parseTime(cells[0], cells[1])
      : parseTime(cells[0]);

    const open = Number(cells[o]);
    const high = Number(cells[o + 1]);
    const low = Number(cells[o + 2]);
    const close = Number(cells[o + 3]);
    const volume = Number(cells[o + 4]);

    if (
      Number.isNaN(time) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      skipped++;
      continue;
    }

    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }

  // Chronological order, and de-duplicate identical timestamps (keep the last).
  candles.sort((a, b) => a.time - b.time);
  const deduped: Candle[] = [];
  for (const c of candles) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.time === c.time) deduped[deduped.length - 1] = c;
    else deduped.push(c);
  }

  return { candles: deduped, skipped };
}
