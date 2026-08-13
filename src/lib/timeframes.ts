/**
 * The timeframe ladder shared by the Dashboard and Experimental Lab.
 *
 * Kept in one place so adding a frame is a single edit rather than a hunt
 * through parallel `useState` declarations in two large pages.
 */

import type { Candle } from "./priceApi";

export const TIMEFRAMES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

export const TF_LABELS: Record<Timeframe, string> = {
  "1m": "1 MIN",
  "3m": "3 MIN",
  "5m": "5 MIN",
  "15m": "15 MIN",
  "30m": "30 MIN",
  "1h": "1 HOUR",
  "4h": "4 HOUR",
  "1d": "1 DAY",
};

/**
 * Bollinger bands help on the slower charts where mean-reversion is legible;
 * on the fast scalping frames they just add noise.
 */
export const TF_SHOW_BB: Record<Timeframe, boolean> = {
  "1m": false,
  "3m": false,
  "5m": false,
  "15m": true,
  "30m": true,
  "1h": true,
  "4h": true,
  "1d": true,
};

/** A fresh, fully-populated per-timeframe candle map with empty arrays. */
export const emptyByTf = (): Record<Timeframe, Candle[]> => {
  const out = {} as Record<Timeframe, Candle[]>;
  for (const tf of TIMEFRAMES) out[tf] = [];
  return out;
};
