/**
 * Automation — the one page that arms live trading, with the whole chain in
 * front of you.
 *
 * Placing orders on a real account is gated by four switches that all default
 * to off: two live in MetaTrader 5 (the EA's InpAllowTrading input and the
 * terminal's Algo Trading button) and two live here (the data bridge and the
 * execution arm). Nothing trades until every one is on. This page states that
 * plainly, hands you the exact Expert Advisor the bridge expects, and exposes
 * the two app-side switches with the same server-enforced interlock the
 * Settings page uses — execution cannot be armed while the bridge is off.
 */

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Download,
  Loader2,
  Save,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLive } from "@/hooks/useLive";
import { ApiError, type AppConfig, api, type Mt5Status } from "@/lib/api";

function ToggleRow({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground leading-snug">{help}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

function NumberField({
  label,
  help,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  help?: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => {
    setRaw(String(value));
  }, [value]);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <Input
        type="number"
        step={step}
        value={raw}
        onChange={e => {
          setRaw(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
        }}
      />
      {help ? (
        <p className="text-xs text-muted-foreground leading-snug">{help}</p>
      ) : null}
    </div>
  );
}

/** One line in the arming checklist: a live-derived on/off with an explanation. */
function CheckItem({
  done,
  label,
  help,
}: {
  done: boolean;
  label: string;
  help: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      {done ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
      ) : (
        <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
      )}
      <div className="space-y-0.5">
        <p
          className={`text-sm font-medium ${done ? "" : "text-muted-foreground"}`}
        >
          {label}
        </p>
        <p className="text-xs text-muted-foreground leading-snug">{help}</p>
      </div>
    </div>
  );
}

/** One numbered manual step the operator performs inside MetaTrader 5. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#D4A843]/15 text-[11px] font-bold text-[#D4A843]">
        {n}
      </span>
      <div className="text-sm text-muted-foreground leading-relaxed pt-0.5">
        {children}
      </div>
    </div>
  );
}

export function AutomationPage() {
  const saved = useLive(() => api.config(), ["config"]);
  const mt5 = useLive<Mt5Status>(() => api.mt5Status(), ["mt5", "config"]);

  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (saved && draft === null) setDraft(structuredClone(saved));
  }, [saved, draft]);

  const dirty = useMemo(() => {
    if (!saved || !draft) return false;
    return JSON.stringify(saved) !== JSON.stringify(draft);
  }, [saved, draft]);

  const update = useCallback((fn: (d: AppConfig) => void) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.saveConfig(draft);
      toast.success("Saved. The engine picked it up immediately.");
    } catch (e) {
      if (e instanceof ApiError && e.issues.length > 0) {
        toast.error(e.issues[0].message);
      } else {
        toast.error(e instanceof Error ? e.message : "Could not save");
      }
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading…
      </div>
    );
  }

  const bridgeOn = draft.mt5.enabled;
  const executionArmed = draft.mt5.executionEnabled;
  const autoTrading = draft.engine.autoTradingEnabled;
  const terminalConnected = mt5?.connected ?? false;
  const fullyArmed =
    bridgeOn && executionArmed && autoTrading && terminalConnected;

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#D4A843] to-[#9A7A30] flex items-center justify-center">
          <Zap className="w-5 h-5 text-[#0A0C10]" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Automation</h1>
          <p className="text-[11px] text-muted-foreground">
            Everything needed to let the app place orders in MetaTrader 5 — in
            one place.
          </p>
        </div>
      </div>

      {/* Demo-first safety banner */}
      <div className="rounded-lg border border-amber-600/40 bg-amber-500/5 px-4 py-3 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-200/90 leading-relaxed">
          <span className="font-semibold text-amber-300">
            Arm this on a demo account first.
          </span>{" "}
          Confirm which account your terminal is logged into before turning
          anything on. Nothing in this app has a forward-tested record — treat a
          live account as real money at risk.
        </div>
      </div>

      {/* Live arming status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {fullyArmed ? (
              <span className="text-emerald-500">
                ● Live — orders will fire
              </span>
            ) : (
              <span className="text-muted-foreground">
                ○ Not armed — nothing will trade
              </span>
            )}
          </CardTitle>
          <CardDescription>
            All four must be on. The two MetaTrader 5 switches can't be read
            from here — tick them off yourself as you set them.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <CheckItem
            done={terminalConnected}
            label="MetaTrader 5 bridge is delivering fresh data"
            help="The TeoExporter EA is on a chart and this app is reading its files. Turned on below."
          />
          <CheckItem
            done={bridgeOn}
            label="Data bridge enabled (this app)"
            help="Reads bars and specs from the terminal. Read-only; cannot place orders on its own."
          />
          <CheckItem
            done={executionArmed}
            label="Execution armed (this app)"
            help="Lets accepted signals be written as order files. Requires the bridge above."
          />
          <CheckItem
            done={autoTrading}
            label="Signal engine running (this app)"
            help="The master switch. When off, no new signals are generated, so nothing is ever placed."
          />
        </CardContent>
      </Card>

      {/* The switches */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            App switches
          </CardTitle>
          <CardDescription>
            Off by default. Execution is deliberately separate from reading
            data: reading bars cannot lose money, placing orders can. The
            interlock is enforced on the server, not just hidden here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <ToggleRow
            label="Signal engine (generate new ideas)"
            help="The master switch. Turn on to let the strategy produce signals. Open positions keep being monitored even when this is off."
            checked={autoTrading}
            onChange={v =>
              update(d => {
                d.engine.autoTradingEnabled = v;
              })
            }
          />
          <ToggleRow
            label="Read from MetaTrader 5 (data bridge)"
            help="Pulls bars and your broker's real symbol specs on a timer. Read-only."
            checked={bridgeOn}
            onChange={v =>
              update(d => {
                d.mt5.enabled = v;
                // Turning the bridge off must disarm execution: orders written
                // for a bridge nothing reads look exactly like broker rejects.
                if (!v) d.mt5.executionEnabled = false;
              })
            }
          />
          <ToggleRow
            label="Let the app place orders in MT5 (execution)"
            help="Requires the bridge above. Every accepted signal is written as an order file for the EA to place on your account."
            checked={executionArmed}
            disabled={!bridgeOn}
            onChange={v =>
              update(d => {
                d.mt5.executionEnabled = v;
              })
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 pt-2">
            <NumberField
              label="Lots per order"
              help="Fixed size. Start at your broker's minimum (often 0.01) for the first live test."
              step={0.01}
              value={draft.mt5.lotSize}
              onChange={v =>
                update(d => {
                  d.mt5.lotSize = v;
                })
              }
            />
            <NumberField
              label="Max open positions"
              help="The bridge refuses new orders once this many are already working."
              value={draft.mt5.maxOpenPositions}
              onChange={v =>
                update(d => {
                  d.mt5.maxOpenPositions = v;
                })
              }
            />
          </div>
          <div className="pt-3">
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* The Expert Advisor + placement */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">The MetaTrader 5 side</CardTitle>
          <CardDescription>
            Install the Expert Advisor once. It exports bars to this app and,
            when you allow it, places the orders the app requests.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <a href={api.mt5ExporterUrl()} download="TeoExporter.mq5">
            <Button variant="outline">
              <Download className="h-4 w-4" />
              Download TeoExporter.mq5
            </Button>
          </a>

          <div className="space-y-3 pt-1">
            <Step n={1}>
              In MetaTrader 5: <b>File → Open Data Folder</b>, then open{" "}
              <code className="text-[11px]">MQL5 / Experts</code>.
            </Step>
            <Step n={2}>
              Copy the downloaded{" "}
              <code className="text-[11px]">TeoExporter.mq5</code> into that{" "}
              <code className="text-[11px]">Experts</code> folder.
            </Step>
            <Step n={3}>
              Back in MT5, open the <b>Navigator</b> (Ctrl+N), right-click{" "}
              <b>Expert Advisors → Refresh</b>, then double-click{" "}
              <b>TeoExporter</b> to compile it (or press <b>F7</b> in
              MetaEditor).
            </Step>
            <Step n={4}>
              Drag <b>TeoExporter</b> from the Navigator onto any <b>XAUUSD</b>{" "}
              chart. A smiley face in the top-right of the chart means it's
              running.
            </Step>
            <Step n={5}>
              For data only, that's it — come back here and turn on the{" "}
              <b>data bridge</b>, then press <b>Find terminal</b> on the
              Settings page if it doesn't connect on its own.
            </Step>
            <Step n={6}>
              To let it trade: open the EA's settings (drag it on again or press{" "}
              its properties), set{" "}
              <code className="text-[11px]">InpAllowTrading = true</code>, and
              click the <b>Algo Trading</b> button in the MT5 toolbar so it
              turns green. Then arm <b>execution</b> above.
            </Step>
          </div>

          <div className="rounded-lg border border-white/5 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
            Turn it off in the reverse order: disarm <b>execution</b> here, then
            set <code className="text-[11px]">InpAllowTrading = false</code> and
            switch off <b>Algo Trading</b> in MT5.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
