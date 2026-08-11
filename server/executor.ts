/**
 * MT5 execution bridge — turns trading ideas into real broker orders.
 *
 * WHY A FILE BRIDGE (again)
 * The same constraint that shapes TeoExporter.mq5 shapes this: there is no
 * macOS/Linux MetaTrader5 Python package, so the server cannot call the
 * terminal directly. What it CAN do is drop a small JSON command file into the
 * terminal's MQL5/Files directory, which is an ordinary directory on the host.
 * A companion EA (mt5/TeoTrader.mq5) polls that directory, calls OrderSend for
 * each command, and writes a response file back. This module owns the server
 * half of that protocol.
 *
 * PROTOCOL
 *   server → EA   <bridge>/commands/<clientId>.json   (this module writes)
 *   EA → server   <bridge>/responses/<clientId>.json  (the EA writes)
 * clientId is a UUID that is also the DB row's idempotency key, so replaying a
 * command file can never open a second position — the EA refuses a clientId it
 * has already acted on, and the server refuses a clientId already terminal.
 *
 * SAFETY
 *   * Nothing is sent for a live account unless it is `enabled`.
 *   * Auto-dispatch only fires for accounts whose execution mode is 'auto';
 *     everything else waits for an explicit send from the UI.
 *   * Position size is computed from the account's own risk config, never
 *     assumed, and is clamped to [minLot, maxLots] and the broker's lot step.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Db, ExecutionOrderRow, Mt5AccountRow, TradingIdea } from "./db";
import { publish } from "./events";
import { findExportDir } from "./mt5";

// ─── Risk / sizing ───

export type RiskConfig =
  | {
      mode: "fixed_fraction";
      /** Percent of equity risked per trade, e.g. 1 = 1%. */
      riskPct: number;
      /** Account equity the fraction is taken of (user-entered; refreshed rarely). */
      equity: number;
      /** Units per 1.00 lot. Gold is 100 oz; FX majors 100_000. */
      contractSize?: number;
      lotStep?: number;
      minLot?: number;
      maxLots?: number;
    }
  | {
      mode: "fixed_lot";
      lots: number;
    };

/** Sensible starting points offered in the UI. equity is a placeholder the user overrides. */
export const RISK_PRESETS: Record<string, RiskConfig> = {
  conservative: {
    mode: "fixed_fraction",
    riskPct: 0.5,
    equity: 10_000,
    contractSize: 100,
    lotStep: 0.01,
    minLot: 0.01,
    maxLots: 5,
  },
  balanced: {
    mode: "fixed_fraction",
    riskPct: 1,
    equity: 10_000,
    contractSize: 100,
    lotStep: 0.01,
    minLot: 0.01,
    maxLots: 10,
  },
  aggressive: {
    mode: "fixed_fraction",
    riskPct: 2,
    equity: 10_000,
    contractSize: 100,
    lotStep: 0.01,
    minLot: 0.01,
    maxLots: 20,
  },
};

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/**
 * Lots to trade for one idea under a risk config.
 *
 * For fixed-fraction the dollar risk is `equity * riskPct%`, and the loss if
 * the stop is hit is `stopDistance * contractSize * lots`, so
 * `lots = risk / (stopDistance * contractSize)`. A missing or zero stop
 * distance would divide by zero and size infinitely — that returns 0 (no
 * trade) rather than a poisoned order.
 */
export function computeLots(idea: TradingIdea, risk: RiskConfig): number {
  if (risk.mode === "fixed_lot") {
    return Math.max(0, risk.lots);
  }
  const stopDistance = Math.abs(idea.entry_price - idea.stop_loss);
  if (!(stopDistance > 0)) return 0;
  const contractSize = risk.contractSize ?? 100;
  const riskAmount = (risk.equity * risk.riskPct) / 100;
  const raw = riskAmount / (stopDistance * contractSize);
  const step = risk.lotStep ?? 0.01;
  const minLot = risk.minLot ?? 0.01;
  const maxLots = risk.maxLots ?? 100;
  const clamped = Math.min(Math.max(raw, minLot), maxLots);
  return roundToStep(clamped, step);
}

function parseRisk(account: Mt5AccountRow): RiskConfig {
  try {
    return JSON.parse(account.risk_json) as RiskConfig;
  } catch {
    return RISK_PRESETS.balanced;
  }
}

// ─── Bridge filesystem ───

/**
 * Resolve the teo bridge directory for an account.
 *
 * An explicit terminal_dir wins (the only workable choice with more than one
 * terminal, since auto-discovery can only ever pick one). Otherwise fall back
 * to the same discovery the data importer uses.
 */
export function resolveBridgeDir(account: Mt5AccountRow): string | null {
  if (account.terminal_dir) return account.terminal_dir;
  return findExportDir("teo");
}

function commandsDir(bridge: string): string {
  return join(bridge, "commands");
}
function responsesDir(bridge: string): string {
  return join(bridge, "responses");
}

interface Command {
  clientId: string;
  action: "OPEN" | "CLOSE";
  symbol: string;
  side?: "BUY" | "SELL";
  lots?: number;
  sl?: number;
  tp?: number;
  ticket?: number;
  comment?: string;
}

function writeCommand(bridge: string, cmd: Command): void {
  const dir = commandsDir(bridge);
  mkdirSync(dir, { recursive: true });
  // Write to a temp name then rename, so the EA never reads a half-written file.
  const finalPath = join(dir, `${cmd.clientId}.json`);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(cmd));
  renameSync(tmpPath, finalPath);
}

interface ResponseFile {
  clientId?: string;
  ok?: boolean;
  ticket?: number;
  price?: number;
  error?: string;
}

// ─── Dispatch ───

const uuid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export interface DispatchResult {
  accountId: number;
  orderId?: number;
  lots?: number;
  skipped?: string;
}

/**
 * Send one idea to one account as a market OPEN. Returns why it was skipped
 * (no bridge dir, zero size, already sent) instead of throwing, so a bad
 * account never blocks the others in a fan-out.
 */
export function sendIdeaToAccount(
  db: Db,
  idea: TradingIdea,
  account: Mt5AccountRow,
): DispatchResult {
  if (!account.enabled) return { accountId: account.id, skipped: "disabled" };

  // Idempotency: one open order per (account, idea).
  if (db.openOrderForIdea(account.id, idea.id)) {
    return { accountId: account.id, skipped: "already sent" };
  }

  const bridge = resolveBridgeDir(account);
  if (!bridge) {
    return { accountId: account.id, skipped: "no terminal dir found" };
  }

  const lots = computeLots(idea, parseRisk(account));
  if (!(lots > 0)) {
    return { accountId: account.id, skipped: "computed size 0" };
  }

  const clientId = uuid();
  const orderId = db.createOrder({
    accountId: account.id,
    ideaId: idea.id,
    clientId,
    action: "OPEN",
    direction: idea.direction,
    symbol: account.symbol,
    lots,
    entryPrice: idea.entry_price,
    stopLoss: idea.stop_loss,
    takeProfit: idea.tp2,
  });

  try {
    writeCommand(bridge, {
      clientId,
      action: "OPEN",
      symbol: account.symbol,
      side: idea.direction === "LONG" ? "BUY" : "SELL",
      lots,
      sl: idea.stop_loss,
      tp: idea.tp2,
      comment: `teo#${idea.id}`,
    });
    db.updateOrderStatus(orderId, "SENT");
  } catch (e) {
    db.updateOrderStatus(orderId, "ERROR", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return { accountId: account.id, orderId, lots };
}

/**
 * Auto-dispatch hook: called right after an idea is created. Fans the idea out
 * to every enabled auto account. A no-op (returns []) when none are configured,
 * so the engine behaves exactly as before until a user opts an account in.
 */
export function dispatchIdea(db: Db, ideaId: number): DispatchResult[] {
  const accounts = db.autoAccounts();
  if (accounts.length === 0) return [];
  const idea = db.getIdea(ideaId);
  if (!idea) return [];

  const results = accounts.map(a => sendIdeaToAccount(db, idea, a));
  const sent = results.filter(r => r.orderId).length;
  if (sent > 0) {
    db.logJournal({
      eventType: "ORDER_DISPATCHED",
      asset: idea.asset,
      ideaId: idea.id,
      direction: idea.direction,
      price: idea.entry_price,
      details: `Auto-dispatched to ${sent} account(s)`,
      metadata: { results },
    });
    publish("orders");
  }
  return results;
}

/** Queue a CLOSE for an order that has a live ticket. */
export function closeOrder(db: Db, order: ExecutionOrderRow): DispatchResult {
  const account = db.getAccount(order.account_id);
  if (!account) return { accountId: order.account_id, skipped: "no account" };
  if (order.ticket == null) {
    return { accountId: account.id, skipped: "no ticket to close" };
  }
  const bridge = resolveBridgeDir(account);
  if (!bridge) return { accountId: account.id, skipped: "no terminal dir" };

  const clientId = uuid();
  const orderId = db.createOrder({
    accountId: account.id,
    ideaId: order.idea_id,
    clientId,
    action: "CLOSE",
    symbol: order.symbol,
    lots: order.lots,
  });
  try {
    writeCommand(bridge, {
      clientId,
      action: "CLOSE",
      symbol: order.symbol,
      ticket: order.ticket,
    });
    db.updateOrderStatus(orderId, "SENT");
  } catch (e) {
    db.updateOrderStatus(orderId, "ERROR", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return { accountId: account.id, orderId };
}

// ─── Response polling ───

/**
 * Read fills/rejects the EAs wrote back and reconcile them into the DB.
 *
 * Runs on a timer. For each enabled account it scans its responses directory,
 * matches each file's clientId to the pending order, records the outcome, and
 * deletes the file so it is processed once. Unknown or already-terminal
 * clientIds are dropped (the file is still removed) rather than erroring.
 */
export function pollResponses(db: Db): number {
  const accounts = db.listAccounts();
  const bridges = new Set<string>();
  for (const a of accounts) {
    const b = resolveBridgeDir(a);
    if (b) bridges.add(b);
  }

  let handled = 0;
  for (const bridge of bridges) {
    const dir = responsesDir(bridge);
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir).filter(f => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      const full = join(dir, file);
      let resp: ResponseFile;
      try {
        resp = JSON.parse(readFileSync(full, "utf8")) as ResponseFile;
      } catch {
        rmSync(full, { force: true });
        continue;
      }
      const clientId = resp.clientId ?? file.replace(/\.json$/, "");
      const order = db.getOrderByClientId(clientId);
      if (order && (order.status === "PENDING" || order.status === "SENT")) {
        if (resp.ok) {
          db.updateOrderStatus(order.id, "FILLED", {
            ticket: resp.ticket ?? null,
            fillPrice: resp.price ?? null,
          });
        } else {
          db.updateOrderStatus(order.id, "REJECTED", {
            error: resp.error ?? "rejected by terminal",
          });
        }
        handled++;
      }
      rmSync(full, { force: true });
    }
  }
  if (handled > 0) publish("orders");
  return handled;
}
