/**
 * Crypto — the exchange-fed side of the book on one page.
 *
 * The engine already trades the crypto assets in the registry (BTC, ETH, BNB,
 * LINK, AAVE, TAO); the Dashboard is just gold-only. This page surfaces the
 * rest: a card per enabled Binance asset with its live 24h stats, a
 * TradingView-style mini chart, and whatever idea the engine currently has
 * open on it. Anything the strategy has to say about crypto shows up here.
 */

import { Bitcoin, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MiniChart } from "@/components/dashboard/MultiTimeframeView";
import { Skeleton } from "@/components/ui/skeleton";
import { useLive } from "@/hooks/useLive";
import {
  type AssetInfo,
  api,
  type Candle,
  type Idea,
  type Ticker,
} from "@/lib/api";

/** Enabled, exchange-fed assets that are not the gold proxy. */
function useCryptoAssets(): AssetInfo[] {
  const data = useLive(() => api.assets(), ["config"]);
  return (data?.assets ?? []).filter(
    a => a.enabled && a.dataSource === "binance" && a.id !== "PAXGUSDT",
  );
}

export function CryptoPage() {
  const assets = useCryptoAssets();
  const ids = assets.map(a => a.id).join(",");
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});

  // 24h stats come in one batched request; poll on a timer since the server
  // does not publish a price event.
  const loadPrices = useCallback(async () => {
    if (!ids) return;
    try {
      const { tickers: rows } = await api.prices(ids.split(","));
      const byId: Record<string, Ticker> = {};
      for (const t of rows) byId[t.symbol] = t;
      setTickers(byId);
    } catch {
      // Leave the last good prices in place rather than blanking the page.
    }
  }, [ids]);

  useEffect(() => {
    loadPrices();
    const timer = setInterval(loadPrices, 30000);
    return () => clearInterval(timer);
  }, [loadPrices]);

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 max-w-[1440px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#F7931A] to-[#B76A0F] flex items-center justify-center">
          <Bitcoin className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Crypto</h1>
          <p className="text-[11px] text-muted-foreground">
            Live prices, charts and open ideas for the exchange-fed assets the
            engine trades.
          </p>
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Skeleton className="h-[280px] rounded-xl" />
          <Skeleton className="h-[280px] rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {assets.map(asset => (
            <CryptoCard
              key={asset.id}
              asset={asset}
              ticker={tickers[asset.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CryptoCard({ asset, ticker }: { asset: AssetInfo; ticker?: Ticker }) {
  const candleData = useLive<{ candles: Candle[] }>(
    () => api.candles(asset.id, "5m", 200),
    ["candles"],
    [asset.id],
  );
  const ideaData = useLive<{ ideas: Idea[] }>(
    () => api.openIdeas({ asset: asset.id }),
    ["ideas"],
    [asset.id],
  );

  const candles = candleData?.candles ?? [];
  const idea = ideaData?.ideas?.[0] ?? null;
  const up = (ticker?.changePct24h ?? 0) >= 0;
  const changeColor = up ? "#00E676" : "#FF1744";

  const fmt = (n: number) =>
    n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: asset.precision,
    });

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
      {/* Header row: symbol + price + 24h change */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold font-mono truncate">
            {asset.symbol}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {ticker ? (
            <>
              <span className="text-sm font-mono tabular-nums">
                ${fmt(ticker.price)}
              </span>
              <span
                className="flex items-center gap-1 text-xs font-mono tabular-nums"
                style={{ color: changeColor }}
              >
                {up ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                {up ? "+" : ""}
                {ticker.changePct24h.toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground/50 font-mono">
              price unavailable
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      {candles.length > 0 ? (
        <MiniChart
          candles={candles}
          label="5 MIN"
          height={200}
          showEMA
          showBB={false}
        />
      ) : (
        <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground/40 font-mono">
          No candle data yet
        </div>
      )}

      {/* Open idea, if any */}
      <div className="px-3 py-2 border-t border-border">
        {idea ? (
          <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
            <span
              className="font-bold"
              style={{
                color: idea.direction === "LONG" ? "#00E676" : "#FF1744",
              }}
            >
              {idea.direction}
            </span>
            <span className="text-muted-foreground">
              @ {fmt(idea.entryPrice)}
            </span>
            <span className="text-muted-foreground/60">
              SL {fmt(idea.stopLoss)} · TP {fmt(idea.tp2)}
            </span>
            <span className="ml-auto px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground">
              {idea.status}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground/40 font-mono">
            No open idea
          </span>
        )}
      </div>
    </div>
  );
}
