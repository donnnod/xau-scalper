import { Cpu, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLive, useMutation } from "@/hooks/useLive";
import {
  type Account,
  type AccountInput,
  api,
  type ExecutionOrder,
  type RiskConfig,
} from "@/lib/api";

const PRESET_KEYS = ["conservative", "balanced", "aggressive"] as const;

const STATUS_COLOR: Record<ExecutionOrder["status"], string> = {
  PENDING: "text-yellow-400",
  SENT: "text-blue-400",
  FILLED: "text-green-400",
  REJECTED: "text-red-400",
  ERROR: "text-red-400",
  CANCELLED: "text-muted-foreground",
};

function emptyForm(): AccountInput {
  return {
    label: "",
    mode: "demo",
    symbol: "XAUUSD",
    terminalDir: "",
    execution: "manual",
    enabled: true,
    risk: {
      mode: "fixed_fraction",
      riskPct: 1,
      equity: 10_000,
      contractSize: 100,
      lotStep: 0.01,
      minLot: 0.01,
      maxLots: 10,
    },
  };
}

export default function ExecutionPage() {
  const accounts = useLive(() => api.accounts().then(r => r.accounts), [
    "orders",
  ]);
  const orders = useLive(
    () => api.orders({ limit: 100 }).then(r => r.orders),
    ["orders"],
  );
  const presets = useLive(() => api.presets().then(r => r.presets), []);

  const [createAccount] = useMutation((a: AccountInput) =>
    api.createAccount(a),
  );
  const [updateAccount] = useMutation(
    (a: { id: number; patch: Partial<AccountInput> }) =>
      api.updateAccount(a.id, a.patch),
  );
  const [deleteAccount] = useMutation((id: number) => api.deleteAccount(id));
  const [closeOrder] = useMutation((id: number) => api.closeOrder(id));

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AccountInput>(emptyForm);

  const applyPreset = (key: string) => {
    const p = presets?.[key];
    if (p) setForm(f => ({ ...f, risk: { ...p } }));
  };

  const submit = async () => {
    if (!form.label.trim()) {
      toast.error("Give the account a label");
      return;
    }
    if (form.mode === "live") {
      const ok = window.confirm(
        `"${form.label}" is a LIVE account. Orders sent to it place real trades with real money. Continue?`,
      );
      if (!ok) return;
    }
    const res = await createAccount({
      ...form,
      terminalDir: form.terminalDir?.trim() || null,
    });
    if (!res) {
      toast.error("Failed to save account");
      return;
    }
    toast.success("Account connected");
    setShowForm(false);
    setForm(emptyForm());
  };

  const accountLabel = (id: number) =>
    accounts?.find(a => a.id === id)?.label ?? `#${id}`;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Cpu className="size-5 text-[#D4A843]" />
            Execution
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect MT5 terminals and let the engine place orders. Auto accounts
            trade every new idea; manual accounts wait for a send.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(v => !v)}
          className="inline-flex items-center gap-2 rounded-md bg-[#D4A843] px-3 py-2 text-sm font-medium text-[#0A0C10] hover:opacity-90"
        >
          {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
          {showForm ? "Cancel" : "Connect account"}
        </button>
      </header>

      <div className="rounded-lg border border-yellow-600/30 bg-yellow-600/5 p-3 text-xs text-yellow-200/80">
        Orders reach MT5 through a file bridge: install{" "}
        <code className="font-mono">mt5/TeoTrader.mq5</code> on each terminal and
        enable algo trading. Start on a demo account and confirm fills appear
        below before switching an account to live.
      </div>

      {showForm && (
        <AccountForm
          form={form}
          setForm={setForm}
          onSubmit={submit}
          onPreset={applyPreset}
        />
      )}

      {/* Accounts */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Accounts
        </h2>
        {!accounts?.length ? (
          <p className="text-sm text-muted-foreground">
            No accounts connected yet.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {accounts.map(a => (
              <AccountCard
                key={a.id}
                account={a}
                onToggleEnabled={() =>
                  updateAccount({ id: a.id, patch: { enabled: !a.enabled } })
                }
                onToggleExecution={() =>
                  updateAccount({
                    id: a.id,
                    patch: {
                      execution: a.execution === "auto" ? "manual" : "auto",
                    },
                  })
                }
                onDelete={async () => {
                  if (window.confirm(`Remove "${a.label}"?`)) {
                    await deleteAccount(a.id);
                    toast.success("Removed");
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Orders */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Orders
        </h2>
        {!orders?.length ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Dir</th>
                  <th className="px-3 py-2">Lots</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Ticket</th>
                  <th className="px-3 py-2">Fill</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-t border-border/60">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(o.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {accountLabel(o.accountId)}
                    </td>
                    <td className="px-3 py-2">{o.action}</td>
                    <td className="px-3 py-2">{o.direction ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">{o.lots.toFixed(2)}</td>
                    <td
                      className={`px-3 py-2 font-medium ${STATUS_COLOR[o.status]}`}
                    >
                      {o.status}
                      {o.error && (
                        <span
                          className="ml-1 text-xs text-muted-foreground"
                          title={o.error}
                        >
                          ⓘ
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {o.ticket ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {o.fillPrice != null ? o.fillPrice : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {o.action === "OPEN" &&
                        o.status === "FILLED" &&
                        o.ticket != null && (
                          <button
                            type="button"
                            onClick={async () => {
                              await closeOrder(o.id);
                              toast.success("Close queued");
                            }}
                            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                          >
                            Close
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";

function AccountForm({
  form,
  setForm,
  onSubmit,
  onPreset,
}: {
  form: AccountInput;
  setForm: React.Dispatch<React.SetStateAction<AccountInput>>;
  onSubmit: () => void;
  onPreset: (key: string) => void;
}) {
  const risk = form.risk;
  const setRisk = (patch: Partial<RiskConfig>) =>
    setForm(f => ({ ...f, risk: { ...f.risk, ...patch } as RiskConfig }));

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Label">
          <input
            className={inputCls}
            value={form.label}
            placeholder="e.g. IC Markets demo"
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          />
        </Field>
        <Field label="Broker symbol">
          <input
            className={inputCls}
            value={form.symbol}
            onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
          />
        </Field>
        <Field label="Account type">
          <select
            className={inputCls}
            value={form.mode}
            onChange={e =>
              setForm(f => ({ ...f, mode: e.target.value as "demo" | "live" }))
            }
          >
            <option value="demo">Demo</option>
            <option value="live">Live</option>
          </select>
        </Field>
        <Field label="Execution">
          <select
            className={inputCls}
            value={form.execution}
            onChange={e =>
              setForm(f => ({
                ...f,
                execution: e.target.value as "auto" | "manual",
              }))
            }
          >
            <option value="manual">Manual — send each trade myself</option>
            <option value="auto">Auto — trade every idea</option>
          </select>
        </Field>
      </div>

      <Field label="Terminal bridge directory (optional — auto-discovered if blank)">
        <input
          className={inputCls}
          value={form.terminalDir ?? ""}
          placeholder="…/MQL5/Files/teo"
          onChange={e => setForm(f => ({ ...f, terminalDir: e.target.value }))}
        />
      </Field>

      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Risk preset:</span>
          {PRESET_KEYS.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => onPreset(k)}
              className="rounded border border-border px-2 py-1 text-xs capitalize hover:bg-muted"
            >
              {k}
            </button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Sizing mode">
            <select
              className={inputCls}
              value={risk.mode}
              onChange={e =>
                e.target.value === "fixed_lot"
                  ? setForm(f => ({
                      ...f,
                      risk: { mode: "fixed_lot", lots: 0.1 },
                    }))
                  : setForm(f => ({
                      ...f,
                      risk: {
                        mode: "fixed_fraction",
                        riskPct: 1,
                        equity: 10_000,
                        contractSize: 100,
                        lotStep: 0.01,
                        minLot: 0.01,
                        maxLots: 10,
                      },
                    }))
              }
            >
              <option value="fixed_fraction">Fixed % risk</option>
              <option value="fixed_lot">Fixed lot</option>
            </select>
          </Field>

          {risk.mode === "fixed_fraction" ? (
            <>
              <Field label="Risk % per trade">
                <input
                  type="number"
                  step="0.1"
                  className={inputCls}
                  value={risk.riskPct}
                  onChange={e =>
                    setRisk({ riskPct: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Account equity">
                <input
                  type="number"
                  step="100"
                  className={inputCls}
                  value={risk.equity}
                  onChange={e => setRisk({ equity: Number(e.target.value) })}
                />
              </Field>
              <Field label="Contract size (units/lot)">
                <input
                  type="number"
                  className={inputCls}
                  value={risk.contractSize ?? 100}
                  onChange={e =>
                    setRisk({ contractSize: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Max lots">
                <input
                  type="number"
                  step="0.01"
                  className={inputCls}
                  value={risk.maxLots ?? 10}
                  onChange={e => setRisk({ maxLots: Number(e.target.value) })}
                />
              </Field>
            </>
          ) : (
            <Field label="Lots per trade">
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={risk.lots}
                onChange={e => setRisk({ lots: Number(e.target.value) })}
              />
            </Field>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          className="rounded-md bg-[#D4A843] px-4 py-2 text-sm font-medium text-[#0A0C10] hover:opacity-90"
        >
          Save account
        </button>
      </div>
    </div>
  );
}

function AccountCard({
  account,
  onToggleEnabled,
  onToggleExecution,
  onDelete,
}: {
  account: Account;
  onToggleEnabled: () => void;
  onToggleExecution: () => void;
  onDelete: () => void;
}) {
  const risk = account.risk;
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{account.label}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                account.mode === "live"
                  ? "bg-red-500/15 text-red-400"
                  : "bg-blue-500/15 text-blue-400"
              }`}
            >
              {account.mode}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {account.symbol} ·{" "}
            {risk.mode === "fixed_fraction"
              ? `${risk.riskPct}% of ${risk.equity}`
              : `${risk.lots} lots`}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="text-muted-foreground hover:text-red-400"
          aria-label="Remove account"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onToggleExecution}
          className={`rounded px-2 py-1 text-xs font-medium ${
            account.execution === "auto"
              ? "bg-green-500/15 text-green-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {account.execution === "auto" ? "Auto-trading" : "Manual"}
        </button>
        <button
          type="button"
          onClick={onToggleEnabled}
          className={`rounded px-2 py-1 text-xs font-medium ${
            account.enabled
              ? "bg-green-500/15 text-green-400"
              : "bg-red-500/15 text-red-400"
          }`}
        >
          {account.enabled ? "Enabled" : "Disabled"}
        </button>
      </div>
    </div>
  );
}
