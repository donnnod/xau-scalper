/**
 * A single embedded TradingView Advanced Chart.
 *
 * Unlike the lightweight-charts mini charts elsewhere in the app (which draw
 * the engine's own candle data), this embeds TradingView's full widget, so it
 * can show ANY symbol TradingView carries — not just the assets the engine
 * trades — with TradingView's own drawing tools and indicators.
 *
 * The tv.js script is loaded once for the whole app and shared; each chart
 * instantiates its own widget into a uniquely-identified container.
 */

import { useEffect, useId, useRef } from "react";

declare global {
  interface Window {
    // The tv.js global. Typed as unknown then narrowed at the call site;
    // TradingView ships no types and we only touch the one constructor.
    TradingView?: { widget: new (config: Record<string, unknown>) => unknown };
  }
}

const TV_SRC = "https://s3.tradingview.com/tv.js";

let tvLoader: Promise<void> | null = null;

/** Load tv.js once; every chart awaits the same promise. */
function loadTradingView(): Promise<void> {
  if (typeof window !== "undefined" && window.TradingView) {
    return Promise.resolve();
  }
  if (tvLoader) return tvLoader;
  tvLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TV_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load TradingView")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = TV_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load TradingView"));
    document.head.appendChild(script);
  });
  return tvLoader;
}

export function TradingViewChart({
  symbol,
  interval,
}: {
  symbol: string;
  interval: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // A DOM id TradingView can target. useId is stable across renders but unique
  // per instance, so many charts never collide.
  const rawId = useId();
  const containerId = `tv_${rawId.replace(/[^a-zA-Z0-9_]/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;

    loadTradingView()
      .then(() => {
        if (cancelled || !host || !window.TradingView) return;
        // Clear any previous widget before drawing the new symbol/interval.
        host.innerHTML = "";
        // eslint-disable-next-line no-new
        new window.TradingView.widget({
          container_id: containerId,
          symbol,
          interval,
          autosize: true,
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#0A0C10",
          enable_publishing: false,
          allow_symbol_change: true,
          hide_side_toolbar: false,
          withdateranges: true,
        });
      })
      .catch(() => {
        if (!cancelled && host) {
          host.innerHTML =
            '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:#888;font-family:monospace;font-size:12px;padding:1rem;text-align:center">TradingView failed to load — check your internet connection.</div>';
        }
      });

    return () => {
      cancelled = true;
      if (host) host.innerHTML = "";
    };
  }, [symbol, interval, containerId]);

  return <div id={containerId} ref={hostRef} className="w-full h-full" />;
}
