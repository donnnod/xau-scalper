/**
 * The Strategy Assistant — a Claude-driven agent that can inspect the stored
 * price history, run backtests, and propose a tuned strategy for a symbol.
 *
 * SAFETY: the agent has NO write access. Its only "action" tool, propose_apply,
 * records a proposal and returns; it never touches the config. Applying a
 * strategy to the engine stays a human click in the UI (POST /api/backtest/apply),
 * so the agent can suggest but never arm anything on its own.
 *
 * The loop is hand-written rather than using the SDK tool runner: the tool set
 * is tiny and fixed, and owning the loop keeps the propose-only gate obvious.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  type BacktestModel,
  computeMetrics,
  runBacktest,
} from "../core/backtest";
import { DEFAULT_STRATEGY_CONFIG, type StrategyConfig } from "../core/strategy";
import type { Db } from "./db";

/** A tuned strategy the agent wants applied — surfaced to the UI for approval. */
export interface AgentProposal {
  symbol: string;
  interval: string;
  precision: number;
  config: StrategyConfig;
  summary: string;
}

export interface AgentTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResult {
  reply: string;
  /** Human-readable trace of the tools the agent ran, for the UI action log. */
  log: string[];
  proposals: AgentProposal[];
}

const MODEL = "claude-opus-5";
const MAX_ITERATIONS = 10;

/** Merge an untrusted partial config onto the defaults, numbers only. */
function coerceConfig(raw: unknown): StrategyConfig {
  const out: StrategyConfig = { ...DEFAULT_STRATEGY_CONFIG };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(DEFAULT_STRATEGY_CONFIG) as Array<
      keyof StrategyConfig
    >) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    }
  }
  return out;
}

const SYSTEM = `You are the Strategy Assistant inside a local trading dashboard for gold (XAU) and crypto scalping. You help the operator research and tune trading strategies.

You can:
- list_datasets: see what price history is stored (including files the user uploaded as "upload:<SYMBOL>").
- get_default_config: read the shipped default strategy parameters.
- run_backtest: score a strategy config over a stored dataset and get metrics (net points, win rate, profit factor, drawdown, expectancy).
- propose_apply: record a tuned config for the user to review. This does NOT apply anything — the user must click Approve in the UI. You never arm trading or change config yourself.

How to work:
- When asked to tune, start from get_default_config, backtest it, then change a few parameters at a time and re-backtest, comparing metrics. Explain what you changed and why.
- Be honest about overfitting: one pass over a single history is not proof of edge — a great in-sample number should raise suspicion, not confidence. Say so.
- Keep replies concise and lead with the outcome. Show the key metrics you're comparing.
- Only call propose_apply once you have a config you'd genuinely recommend, and summarise the evidence in its summary.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_datasets",
    description:
      "List every stored price series (asset id, interval, bar count, date range). Uploaded files appear as upload:<SYMBOL>.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_default_config",
    description: "Return the shipped default strategy parameters as an object.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "run_backtest",
    description:
      "Backtest a strategy config over a stored dataset. Returns metrics: trades, winRate, netPoints, profitFactor, maxDrawdown, expectancyPerTrade, costPoints.",
    input_schema: {
      type: "object",
      properties: {
        assetId: {
          type: "string",
          description: "Dataset id from list_datasets, e.g. upload:EURUSD.",
        },
        interval: { type: "string", description: "Timeframe, e.g. 15m, 1h." },
        config: {
          type: "object",
          description:
            "Full or partial StrategyConfig. Omitted fields fall back to defaults.",
        },
        precision: {
          type: "number",
          description: "Price decimals. Default 2.",
        },
      },
      required: ["assetId", "interval"],
    },
  },
  {
    name: "propose_apply",
    description:
      "Record a tuned strategy for the user to review and approve. Does NOT apply anything.",
    input_schema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Symbol to apply to, e.g. EURUSD.",
        },
        interval: { type: "string" },
        precision: { type: "number" },
        config: { type: "object", description: "The tuned StrategyConfig." },
        summary: {
          type: "string",
          description: "One or two sentences of evidence for this config.",
        },
      },
      required: ["symbol", "config", "summary"],
    },
  },
];

/** Run one tool call against the local database. Read-only except propose_apply. */
function runTool(
  db: Db,
  name: string,
  input: Record<string, unknown>,
  proposals: AgentProposal[],
  log: string[],
): unknown {
  switch (name) {
    case "list_datasets": {
      const series = db.candleSeries();
      log.push(`Listed ${series.length} dataset(s).`);
      return series;
    }
    case "get_default_config":
      log.push("Read default config.");
      return DEFAULT_STRATEGY_CONFIG;
    case "run_backtest": {
      const assetId = String(input.assetId ?? "");
      const interval = String(input.interval ?? "15m");
      const precision = Number.isFinite(Number(input.precision))
        ? Number(input.precision)
        : 2;
      const config = coerceConfig(input.config);
      const candles = db.getCandles(assetId, interval, 1_000_000);
      if (candles.length < 100) {
        log.push(`Backtest ${assetId} ${interval}: no data.`);
        return {
          error: `Only ${candles.length} bars for ${assetId} ${interval}.`,
        };
      }
      const trades = runBacktest(
        candles,
        config,
        precision,
        60,
        undefined,
        "combined" as BacktestModel,
      );
      const metrics = computeMetrics(trades);
      log.push(
        `Backtested ${assetId} ${interval}: ${metrics.trades} trades, net ${metrics.netPoints.toFixed(1)}.`,
      );
      return { metrics, bars: candles.length };
    }
    case "propose_apply": {
      const symbol = String(input.symbol ?? "")
        .trim()
        .toUpperCase();
      const proposal: AgentProposal = {
        symbol,
        interval: String(input.interval ?? "15m"),
        precision: Number.isFinite(Number(input.precision))
          ? Number(input.precision)
          : 2,
        config: coerceConfig(input.config),
        summary: String(input.summary ?? ""),
      };
      proposals.push(proposal);
      log.push(
        `Proposed applying a strategy to ${symbol} (awaiting approval).`,
      );
      return {
        recorded: true,
        note: "Proposal recorded. The user must click Approve in the UI to apply it — you cannot apply it yourself.",
      };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

/**
 * Drive the agent to a final answer.
 *
 * `history` is the prior conversation (user/assistant text only). Throws if no
 * API key is configured, so the route can return a clear 400.
 */
export async function runAgent(
  db: Db,
  history: AgentTurn[],
  message: string,
): Promise<AgentResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to the environment before using the agent.",
    );
  }
  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = [
    ...history.map(t => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: message },
  ];

  const log: string[] = [];
  const proposals: AgentProposal[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });

    // Preserve the full assistant turn (including any thinking blocks) so the
    // next request continues correctly.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("\n")
        .trim();
      return { reply, log, proposals };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const result = runTool(
        db,
        block.name,
        (block.input ?? {}) as Record<string, unknown>,
        proposals,
        log,
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply:
      "I hit the tool-call limit before finishing. Try narrowing the request.",
    log,
    proposals,
  };
}
