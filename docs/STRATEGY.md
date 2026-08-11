# XAU/USD — Validated Strategy & Timeframe Study

This document records what actually survived honest testing on the broker's own
H1/H4/M30/M15 bars (2021–2026), so the profitable configuration is reproducible
and the dead ends are not re-explored.

All numbers use the **measured broker spread of 0.53 bps**. Cost assumptions are
first-order: dropping the assumed spread from 1.5 → 0.53 bps moved 1h expectancy
from 1.35 → 1.96 pts/trade — a 45% swing from costs alone. Re-measure your own
spread before trusting any of this.

## The one edge that survives multiple-testing statistics

**`quiet-trend`** — trend continuation (EMA50 direction, with a 0.05% buffer)
taken **only when volatility is in the calmest 50%** of the last 100 bars.

- On **1h**: mean net +1.92 pts/hold over 1,980 occurrences, t = 3.36,
  **p = 0.0008**, positive in **6 of 6** walk-forward windows.
- It is the **only** hypothesis (of 16) that beats the Šidák-corrected bar on any
  timeframe. On 15m, 30m and 4h, nothing survives.

Implemented in [`core/quiet-trend.ts`](../core/quiet-trend.ts) and wired into the
engine as the H1 signal path with an H1-regime veto.

## Timeframe ladder — the scalper gets *worse* as you go faster

Backtest with a real ATR stop + R-multiple target (trend model, last 10k bars):

| Entry TF | Trades | Win rate | Profit factor | Expectancy | Max DD | Verdict |
|----------|-------:|---------:|--------------:|-----------:|-------:|---------|
| 15m      | 859    | 31.6%    | 0.99          | −0.06      | 949    | loses after costs |
| 30m      | 859    | 32.6%    | 1.09          | +1.23      | 742    | thin |
| **1h**   | 866    | 33.6%    | **1.15**      | **+1.96**  | **690**| **best risk-adjusted** |
| 4h       | 775    | 34.2%    | 1.14          | +1.87      | 943    | good edge, deeper DD |

The improvement is monotonic up to **1h**, then plateaus — 4h keeps the edge but
the drawdown balloons. **Finer than 1h bleeds to costs**: per-trade moves shrink
faster than the ~fixed per-trade spread. 15m is net negative.

*(Caveat: backtests use the last 10k bars, so 4h spans the full 5.5 years while
1h spans ~1.8. Edgescans below use full history per timeframe.)*

## Regime filter — trading *against* the higher-TF trend is a reliable loser

Value of trading **with** vs **against** the Daily trend (pts/hold), and the
significance of the counter-trend (against-H4) row:

| Entry TF | with − against (D1) | against-H4 t-stat |
|----------|--------------------:|------------------:|
| 15m      | +0.05               | **−4.13**         |
| 30m      | +0.20               | −2.61             |
| 1h       | +1.56               | −0.45             |
| 4h       | **+6.85**           | +0.13             |

Counter-trend scalping bleeds most punishingly at the **fastest** timeframes
(t = −4.13 on 15m) — the "run over during the London/NY overlap" effect,
quantified. The with-vs-against-Daily gap **grows with timeframe**, making the
higher-TF (especially Daily) trend veto the single most consistent signal in the
whole dataset. This is the hard veto implemented via `htfRegime()`.

## Quiet-trend with real exits (1h, full 5.5 years, 0.53 bps)

Parameter study from [`scripts/quiet-trend-bt.ts`](../scripts/quiet-trend-bt.ts):

| Config (ATR SL / TP)      | Trades | Win rate | Expectancy | Total P&L | Max DD | Windows+ |
|---------------------------|-------:|---------:|-----------:|----------:|-------:|---------:|
| 1.5× / **2.5R** (default) | 2,277  | 34.2%    | +1.05      | +2,396    | **407**| 4/6      |
| **2.0× / 2.0R**           | 1,828  | 40.0%    | **+1.18**  | +2,155    | 442    | 4/6      |
| 1.5× / 2.0R / 48h max     | 2,243  | 35.8%    | +1.05      | +2,356    | 482    | 4/6      |

The shipped default (`DEFAULT_QUIET_TREND_CONFIG`: 1.5× ATR SL, 2.5R TP) has the
**shallowest drawdown**; 2.0×/2.0R has the **highest expectancy**. Both are
positive in **4 of 6** windows — not every sub-period, which is the honest
limitation: this is a positive-expectancy edge over the full sample, not a
metronome.

## Bottom line

The data converges on one design, and it is not a fast scalper:

1. **Entry timeframe: 1h.** Not 5m/15m/30m (cost drag), not 4h (drawdown).
2. **Regime veto: the Daily/H1 trend.** Kill counter-trend entries.
3. **Volatility gate: calm regime only.** The `quiet-trend` filter is the only
   thing that survives honest statistics.

This is exactly what `core/quiet-trend.ts` implements. The realistic expectation
is ~1.0–1.2 pts/trade after costs with a ~400–450 pt drawdown budget — a real but
modest edge that lives or dies on execution cost.

## Reproduce

```bash
bun run mt5:import-h1 && bun run mt5:import-m15 && bun run mt5:import-m30 && bun run mt5:import-h4
bun run mt5:1h-edgescan          # edge scan on 1h (repeat with other intervals)
bun run mt5:1h-backtest          # trend model with real exit
bun run mt5:quiet-trend          # validated strategy, parameter study
```
