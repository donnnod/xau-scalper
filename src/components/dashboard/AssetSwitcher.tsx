/**
 * Asset switcher — picks which instrument the Dashboard / Experimental Lab
 * charts, price and analysis are drawn for.
 *
 * Lists every enabled asset from the live config (gold plus the crypto book),
 * so adding an asset in Settings makes it selectable here with no code change.
 */

import { useLive } from "@/hooks/useLive";
import { type AssetInfo, api } from "@/lib/api";

export interface SelectedAsset {
  id: string;
  /** Display symbol, e.g. "XAU/USD". */
  symbol: string;
  precision: number;
}

export const GOLD_ASSET: SelectedAsset = {
  id: "PAXGUSDT",
  symbol: "XAU/USD",
  precision: 2,
};

/** Enabled, exchange-fed assets from the live config. */
export function useSelectableAssets(): AssetInfo[] {
  const data = useLive(() => api.assets(), ["config"]);
  return (data?.assets ?? []).filter(
    a => a.enabled && a.dataSource === "binance",
  );
}

export function AssetSwitcher({
  selected,
  onSelect,
  accent = "#D4A843",
}: {
  selected: SelectedAsset;
  onSelect: (a: SelectedAsset) => void;
  accent?: string;
}) {
  const assets = useSelectableAssets();
  // Fall back to gold alone until the config has loaded, so the control is
  // never empty.
  const list: AssetInfo[] =
    assets.length > 0
      ? assets
      : [
          {
            id: GOLD_ASSET.id,
            symbol: GOLD_ASSET.symbol,
            precision: GOLD_ASSET.precision,
            enabled: true,
            dataSource: "binance",
          },
        ];

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {list.map(a => {
        const active = a.id === selected.id;
        return (
          <button
            type="button"
            key={a.id}
            onClick={() =>
              onSelect({ id: a.id, symbol: a.symbol, precision: a.precision })
            }
            className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all border ${
              active
                ? "text-black"
                : "text-muted-foreground border-border hover:text-foreground"
            }`}
            style={
              active
                ? { backgroundColor: accent, borderColor: accent }
                : undefined
            }
          >
            {a.symbol}
          </button>
        );
      })}
    </div>
  );
}
