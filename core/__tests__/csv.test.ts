import { describe, expect, test } from "bun:test";
import { parseCandlesCsv } from "../csv";

describe("parseCandlesCsv", () => {
  test("MT5 tab export with split date/time and header", () => {
    const text = [
      "<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>",
      "2024.01.02\t09:00:00\t2050.1\t2051.0\t2049.5\t2050.8\t120",
      "2024.01.02\t09:05:00\t2050.8\t2052.3\t2050.0\t2052.0\t98",
    ].join("\n");
    const { candles, skipped } = parseCandlesCsv(text);
    expect(candles).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(candles[0].open).toBe(2050.1);
    expect(candles[0].close).toBe(2050.8);
    expect(candles[0].volume).toBe(120);
    // 2024-01-02 09:00:00 UTC
    expect(candles[0].time).toBe(Math.floor(Date.UTC(2024, 0, 2, 9, 0) / 1000));
  });

  test("comma CSV with combined datetime and no volume", () => {
    const text = [
      "time,open,high,low,close",
      "2024-01-02 09:00:00,100,101,99,100.5",
      "2024-01-02 09:15:00,100.5,102,100,101.8",
    ].join("\n");
    const { candles } = parseCandlesCsv(text);
    expect(candles).toHaveLength(2);
    expect(candles[1].high).toBe(102);
    expect(candles[0].volume).toBe(0);
  });

  test("sorts and de-duplicates by timestamp", () => {
    const text = [
      "2024-01-02,5,5,5,5",
      "2024-01-01,1,1,1,1",
      "2024-01-02,9,9,9,9", // same day → last wins
    ].join("\n");
    const { candles } = parseCandlesCsv(text);
    expect(candles).toHaveLength(2);
    expect(candles[0].close).toBe(1);
    expect(candles[1].close).toBe(9);
  });

  test("counts unparseable data rows as skipped", () => {
    const text = ["2024-01-01,1,1,1,1", "2024-01-03,x,y,z,w"].join("\n");
    const { candles, skipped } = parseCandlesCsv(text);
    expect(candles).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});
