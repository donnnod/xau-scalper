/**
 * The Strategy Assistant — a model-driven agent that can inspect the stored
 * price history, run backtests, and propose a tuned strategy for a symbol.
 *
 * PROVIDERS: works with Anthropic (Claude) or any OpenAI-compatible endpoint
 * — Groq and Google Gemini both expose one, so their free tiers work here, as
 * does any custom base URL. The provider, model and key are configured from the
 * UI and stored in the local settings table.
 *
 * SAFETY: the agent has NO write access. Its only "action" tool, propose_apply,
 * records a proposal and returns; it never touches the config. Applying a
 * strategy to the engine stays a human click in the UI (POST /api/backtest/apply),
 * so the agent can suggest but never arm anything on its own.
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

export type AgentProviderId = "anthropic" | "groq" | "google" | "custom";

export interface AgentProviderConfig {
  provider: AgentProviderId;
  /** OpenAI-compatible base URL. Ignored for the anthropic provider. */
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Defaults used to prefill the UI and to run each provider. */
export const PROVIDER_DEFAULTS: Record<
  AgentProviderId,
  { label: string; baseUrl: string; model: string }
> = {
  anthropic: {
    label: "Anthropic (Claude)",
    baseUrl: "",
    model: "claude-opus-5",
  },
  groq: {
    label: "Groq (free)",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  google: {
    label: "Google Gemini (free)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
  },
  custom: { label: "Custom (OpenAI-compatible)", baseUrl: "", model: "" },
};

const SETTINGS_KEY = "agent:provider";
const MAX_ITERATIONS = 10;

/**
 * The provider config in effect, from settings with an Anthropic env fallback.
 *
 * If nothing is saved (or the saved Anthropic entry has no key), fall back to
 * ANTHROPIC_API_KEY so the app works out of the box when that env var is set.
 */
export function getAgentConfig(db: Db): AgentProviderConfig {
  const saved = db.getSetting<AgentProviderConfig>(SETTINGS_KEY);
  if (saved?.provider) {
    if (saved.provider === "anthropic" && !saved.apiKey) {
      return { ...saved, apiKey: process.env.ANTHROPIC_API_KEY ?? "" };
    }
    return saved;
  }
  return {
    provider: "anthropic",
    baseUrl: "",
    model: PROVIDER_DEFAULTS.anthropic.model,
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  };
}

/** Persist provider config. An empty apiKey keeps the previously-stored one. */
export function saveAgentConfig(
  db: Db,
  patch: Partial<AgentProviderConfig>,
): AgentProviderConfig {
  const current = db.getSetting<AgentProviderConfig>(SETTINGS_KEY);
  const provider = (patch.provider ??
    current?.provider ??
    "anthropic") as AgentProviderId;
  const next: AgentProviderConfig = {
    provider,
    baseUrl:
      patch.baseUrl ?? current?.baseUrl ?? PROVIDER_DEFAULTS[provider].baseUrl,
    model: patch.model ?? current?.model ?? PROVIDER_DEFAULTS[provider].model,
    // Only overwrite the key when a non-empty one is supplied.
    apiKey: patch.apiKey ? patch.apiKey : (current?.apiKey ?? ""),
  };
  db.setSetting(SETTINGS_KEY, next);
  return next;
}

/** The config with the key masked, safe to return to the UI. */
export function publicAgentConfig(db: Db): {
  provider: AgentProviderId;
  baseUrl: string;
  model: string;
  hasKey: boolean;
} {
  const c = getAgentConfig(db);
  return {
    provider: c.provider,
    baseUrl: c.baseUrl,
    model: c.model,
    hasKey: c.apiKey.length > 0,
  };
}

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

/** Provider-neutral tool definition; `parameters` is a JSON Schema. */
interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: "list_datasets",
    description:
      "List every stored price series (asset id, interval, bar count, date range). Uploaded files appear as upload:<SYMBOL>.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_default_config",
    description: "Return the shipped default strategy parameters as an object.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_backtest",
    description:
      "Backtest a strategy config over a stored dataset. Returns metrics: trades, winRate, netPoints, profitFactor, maxDrawdown, expectancyPerTrade, costPoints.",
    parameters: {
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
    parameters: {
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

// ─── Anthropic (Claude) loop ───

async function runAnthropic(
  db: Db,
  cfg: AgentProviderConfig,
  history: AgentTurn[],
  message: string,
): Promise<AgentResult> {
  const client = new Anthropic(cfg.apiKey ? { apiKey: cfg.apiKey } : {});
  const tools: Anthropic.Tool[] = TOOL_DEFS.map(t => ({
    name: t.name,
    description: t.description,
    // biome-ignore lint/suspicious/noExplicitAny: JSON Schema passthrough
    input_schema: t.parameters as any,
  }));

  const messages: Anthropic.MessageParam[] = [
    ...history.map(t => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: message },
  ];
  const log: string[] = [];
  const proposals: AgentProposal[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: cfg.model,
      max_tokens: 8000,
      system: SYSTEM,
      tools,
      messages,
    });
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
    reply: "Hit the tool-call limit. Try narrowing the request.",
    log,
    proposals,
  };
}

// ─── OpenAI-compatible loop (Groq, Gemini, custom) ───

interface OaiToolCall {
  id: string;
  function: { name: string; arguments: string };
}
interface OaiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
}

async function runOpenAICompatible(
  db: Db,
  cfg: AgentProviderConfig,
  history: AgentTurn[],
  message: string,
): Promise<AgentResult> {
  if (!cfg.baseUrl) throw new Error("This provider needs a base URL.");
  if (!cfg.apiKey) throw new Error("No API key set for this provider.");
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const tools = TOOL_DEFS.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const messages: OaiMessage[] = [
    { role: "system", content: SYSTEM },
    ...history.map(t => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: message },
  ];
  const log: string[] = [];
  const proposals: AgentProposal[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 8000,
        messages,
        tools,
        tool_choice: "auto",
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Provider returned ${res.status}. ${detail.slice(0, 300)}`.trim(),
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: OaiMessage }>;
    };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Provider returned no message.");

    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: (msg.content ?? "").trim(), log, proposals };
    }

    for (const call of msg.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = call.function.arguments
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {};
      } catch {
        input = {};
      }
      const result = runTool(db, call.function.name, input, proposals, log);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }
  return {
    reply: "Hit the tool-call limit. Try narrowing the request.",
    log,
    proposals,
  };
}

/**
 * Drive the agent to a final answer using the configured provider.
 *
 * Throws (with a clear message) when no provider/key is configured, so the
 * route can return a 502 the UI can display.
 */
export async function runAgent(
  db: Db,
  history: AgentTurn[],
  message: string,
): Promise<AgentResult> {
  const cfg = getAgentConfig(db);
  if (cfg.provider === "anthropic") {
    if (!cfg.apiKey) {
      throw new Error(
        "No Anthropic key configured. Set one in the provider settings, or switch to Groq/Gemini.",
      );
    }
    return runAnthropic(db, cfg, history, message);
  }
  return runOpenAICompatible(db, cfg, history, message);
}
