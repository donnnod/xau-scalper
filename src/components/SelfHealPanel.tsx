import { Brain, CircleCheck, Lightbulb, MinusCircle } from "lucide-react";
import { useLive } from "@/hooks/useLive";
import { api, type HealOutcomeRow, type RegimeSummary } from "@/lib/api";

/**
 * What the self-heal loop decided, and why.
 *
 * Shows the holds as prominently as the proposals. A feed of only the times the
 * loop wanted to change something reads as though it were changing things
 * constantly, which is the opposite of what it does.
 */
export function SelfHealPanel({ asset }: { asset?: string }) {
  const feed = useLive(
    () => api.selfHeal({ asset, limit: 20 }),
    ["journal"],
    [asset],
  );
  if (!feed) return null;

  const mine = asset
    ? feed.byAsset.find(a => a.asset === asset)
    : feed.byAsset[0];

  return (
    <div className="bg-[#12141A] border border-white/5 rounded-lg p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-[#D4A843]" />
        <span className="text-sm font-medium">Self-Heal</span>
        <span className="text-[10px] text-muted-foreground">
          proposes · never applies
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {feed.lastRunAt
            ? `last run ${new Date(feed.lastRunAt).toLocaleString()}`
            : "has not run yet"}
        </span>
      </div>

      {feed.outcomes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No cycles recorded yet. The loop runs every 6 hours and writes a row
          each time, whether or not it wants to change anything.
        </p>
      ) : (
        <>
          {mine && mine.regimes.length > 0 && (
            <Regimes regimes={mine.regimes} />
          )}
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {feed.outcomes.map(o => (
              <Decision key={o.id} row={o} showAsset={!asset} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Regimes({ regimes }: { regimes: RegimeSummary[] }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-muted-foreground">
        What it has seen, by regime
      </div>
      {regimes.map(r => (
        <div key={r.regime} className="flex items-center gap-2 text-[11px]">
          <span className="font-mono text-muted-foreground w-40 shrink-0 truncate">
            {r.regime}
          </span>
          <span className="text-muted-foreground">
            {r.records} {r.records === 1 ? "cycle" : "cycles"}
          </span>
          <span className="ml-auto font-mono">
            {/* null, not a number: the sentinel for "did not trade enough to
                rank" is -1e9, and printing it would read as a catastrophe. */}
            {r.scored === 0 ? (
              <span className="text-muted-foreground">
                nothing scored yet
              </span>
            ) : (
              <>
                best {r.bestScore?.toFixed(2)} · median{" "}
                {r.medianScore?.toFixed(2)}
              </>
            )}
          </span>
          {r.proposals > 0 && (
            <span className="text-[9px] px-1.5 rounded bg-yellow-500/20 text-yellow-400 shrink-0">
              {r.proposals} proposed
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Decision({
  row,
  showAsset,
}: {
  row: HealOutcomeRow;
  showAsset: boolean;
}) {
  const proposed = row.action === "propose_swap";
  const style = proposed
    ? { icon: Lightbulb, color: "text-yellow-400", label: "swap proposed" }
    : row.status === "healthy"
      ? { icon: CircleCheck, color: "text-emerald-400", label: "held" }
      : { icon: MinusCircle, color: "text-muted-foreground", label: "held" };

  return (
    <div className="flex items-start gap-2 text-[11px] py-1 border-b border-white/5">
      <style.icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${style.color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {showAsset && (
            <span className="font-mono text-white">{row.asset}</span>
          )}
          <span className={style.color}>{style.label}</span>
          <span className="text-muted-foreground font-mono text-[10px]">
            {row.regime}
          </span>
          <span className="text-muted-foreground text-[10px] ml-auto">
            {new Date(row.at).toLocaleString()}
          </span>
        </div>
        <p className="text-muted-foreground mt-0.5">{row.reason}</p>
      </div>
    </div>
  );
}
