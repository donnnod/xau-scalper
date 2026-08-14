/**
 * The app's architecture, baked in as data.
 *
 * This is a hand-curated snapshot of what the code-graph tools (Graphify) show,
 * frozen into the repo so the "what is in this app and how does it fit together"
 * picture is available IN the app, with no external service and no network call.
 * The Architecture page renders it.
 *
 * It is intentionally a map, not a mirror: the full graph is ~2,000 symbols, far
 * too much to read. What lives here is the load-bearing structure — the
 * subsystems, the files that matter in each, and the real call/data flow that
 * ties them together. Every edge below corresponds to an actual call or import
 * relationship in the code; if the code moves, update this to match.
 *
 * Provenance: derived from the promoted graph at commit 15c50b0
 * (1,974 nodes, 3,841 edges, 173 communities).
 */

export interface ArchModule {
  /** Repo-relative path. */
  path: string;
  /** One line: what this file is responsible for. */
  role: string;
  /** The symbols worth knowing, as they appear in the code. */
  symbols?: string[];
}

export interface ArchSubsystem {
  id: string;
  name: string;
  /** A short paragraph an operator or new contributor can act on. */
  blurb: string;
  /** Tailwind text/border accent, e.g. "amber", "sky". */
  accent: string;
  modules: ArchModule[];
}

/** A directed relationship in the high-level flow diagram. */
export interface ArchFlowEdge {
  from: string;
  to: string;
  /** How the two relate, shown on the edge. */
  label: string;
}

export const ARCH_PROVENANCE = {
  commit: "15c50b0",
  nodes: 1974,
  edges: 3841,
  communities: 173,
} as const;

export const ARCH_SUBSYSTEMS: ArchSubsystem[] = [
  {
    id: "process",
    name: "Process hub",
    accent: "amber",
    blurb:
      "One process is the whole backend. It serves the UI, REST API and SSE " +
      "stream, and drives the trading loops on timers. On boot it recovers and " +
      "reconciles state before any timer starts, so the first monitor tick sees " +
      "an accurate position set. Timers are rebuilt when the config changes.",
    modules: [
      {
        path: "server/index.ts",
        role: "Entry point: Bun.serve, the boot sequence, and the timer loops.",
        symbols: [
          "runSignals()",
          "runMt5()",
          "runIntel()",
          "scheduleTimers()",
          "engineDeps()",
        ],
      },
      {
        path: "server/config.ts",
        role: "Live config store — one immutable snapshot, replaced atomically, with change listeners for the timers.",
        symbols: ["ConfigStore", ".get()", ".save()", ".onChange()"],
      },
      {
        path: "server/api.ts",
        role: "Every HTTP route in one pure function of (db, req, url, config, risk).",
        symbols: ["handleApi()", "handleEvents()"],
      },
      {
        path: "server/events.ts",
        role: "The SSE fan-out: publish() nudges every connected dashboard to refetch.",
        symbols: ["publish()", "handleEvents()"],
      },
    ],
  },
  {
    id: "engine",
    name: "Signal engine",
    accent: "sky",
    blurb:
      "Per asset: sync the latest candles, run the strategy, check portfolio " +
      "correlation and open exposure, ask the risk manager for permission, then " +
      "write the idea AND its journal row before any outcome is known. New ideas " +
      "flow straight to execution when the MT5 arm is on.",
    modules: [
      {
        path: "server/engine.ts",
        role: "The orchestrator. generateForAsset ties the whole per-asset cycle together.",
        symbols: [
          "generateSignals()",
          "generateForAsset()",
          "analyzeFor()",
          "syncCandles()",
          "monitorIdeas()",
          "recoverGap()",
        ],
      },
      {
        path: "server/execution.ts",
        role: "Turns a new idea into an MT5 order file — only when execution is armed.",
        symbols: ["executeIdea()"],
      },
      {
        path: "server/reconciliation.ts",
        role: "Safety net for positions candle-replay could not reach; force-closes ghosts past SL/TP.",
        symbols: ["reconcileState()"],
      },
    ],
  },
  {
    id: "strategy",
    name: "Strategy core",
    accent: "emerald",
    blurb:
      "Framework-free TypeScript shared by the server, the CLI tools and the " +
      "tests. This is the actual edge: a quiet-trend model gated by a " +
      "higher-timeframe regime, scored against a cost model built from the " +
      "broker's own spread. Backtest, parameter sweep and self-heal all run the " +
      "SAME code the live engine runs, so they optimise the real strategy.",
    modules: [
      {
        path: "core/quiet-trend.ts",
        role: "The strategy: grade a setup and filter it by the higher-timeframe regime.",
        symbols: ["analyzeQuietTrend()", "htfRegime()"],
      },
      {
        path: "core/strategy.ts",
        role: "Indicators, the Candle shape and the shared grading primitives.",
        symbols: ["Candle"],
      },
      {
        path: "core/config.ts",
        role: "The config schema, defaults, validation and asset registry — the contract everything else obeys.",
        symbols: [
          "AppConfig",
          "Mt5Config",
          "defaultConfig()",
          "validateConfig()",
          "withDefaults()",
        ],
      },
      {
        path: "core/backtest.ts",
        role: "Replay history through the real strategy, net of costs.",
      },
      {
        path: "core/discovery.ts",
        role: "Search a space of configs with multiple-comparisons correction; reports null results honestly.",
        symbols: ["discover()", "sampleConfig()", "DiscoveryReport"],
      },
      {
        path: "core/selfheal.ts",
        role: "The decision logic behind the 6-hour self-heal: swap a config only when the evidence clears the bar.",
      },
    ],
  },
  {
    id: "risk",
    name: "Risk & persistence",
    accent: "rose",
    blurb:
      "The kill-switch is checked inline, at signal creation — not just at " +
      "execution — so a tripped daily-loss cap stops new ideas at the source. " +
      "All state is one SQLite file; the journal is append-only and written " +
      "before outcomes, so performance is a record, not a reconstruction.",
    modules: [
      {
        path: "server/risk-manager.ts",
        role: "Portfolio risk cap and daily-loss kill switch, reset at UTC midnight.",
        symbols: [
          "RiskManager",
          ".canTrade()",
          ".dailyReset()",
          "riskConfigFromEnv()",
        ],
      },
      {
        path: "server/db.ts",
        role: "The whole data layer over bun:sqlite: ideas, the journal, runs, settings, MT5 specs.",
        symbols: [
          "Db",
          "TradingIdea",
          ".createIdea()",
          ".logJournal()",
          ".openIdeas()",
          ".pruneJournal()",
        ],
      },
      {
        path: "core/portfolio.ts",
        role: "Correlation-aware portfolio risk maths, shared with the engine.",
      },
    ],
  },
  {
    id: "mt5",
    name: "MetaTrader 5 bridge",
    accent: "violet",
    blurb:
      "A directory of JSON the EA rewrites each cycle — freshness is the only " +
      "real signal of a live link. Reading bars and auto-connecting is harmless " +
      "and automatic; writing order files is a separate armed switch that " +
      "defaults off and cannot be armed while the bridge is off.",
    modules: [
      {
        path: "server/mt5bridge.ts",
        role: "Turns one export directory into a running integration: status, ingest, and (armed) order writing.",
        symbols: ["syncOnce()", "status()", "resolveDirectory()"],
      },
      {
        path: "server/mt5.ts",
        role: "Reads and parses one export directory; discovers the terminal's MQL5/Files/teo folder.",
        symbols: [
          "findExportDir()",
          "ingestDir()",
          "parseExport()",
          "costModelFrom()",
        ],
      },
      {
        path: "server/mt5history.ts",
        role: "Request/answer protocol for pulling deep history the EA serves on demand.",
        symbols: ["requestHistory()", "readHistory()"],
      },
      {
        path: "mt5/TeoExporter.mq5",
        role: "The Expert Advisor: exports bars + specs, serves history, and (opt-in) executes order files.",
      },
    ],
  },
  {
    id: "intel",
    name: "Market intel",
    accent: "cyan",
    blurb:
      "Four independent engines run together on the intel timer; one failing " +
      "must not stop the rest. They tag the market so the strategy and the UI " +
      "have context beyond price.",
    modules: [
      {
        path: "server/intel/regime.ts",
        role: "Classifies the current market regime.",
        symbols: ["detectMarketRegime()"],
      },
      {
        path: "server/intel/macroCorrelation.ts",
        role: "Pulls macro series and correlates them against the traded assets.",
        symbols: ["fetchMacroData()"],
      },
      {
        path: "server/intel/newsCalendar.ts",
        role: "Keeps the economic-event calendar current.",
        symbols: ["updateCalendar()"],
      },
      {
        path: "server/intel/liquiditySweep.ts",
        role: "Scans for stop-hunt / liquidity-sweep structure.",
        symbols: ["scanLiquiditySweeps()"],
      },
    ],
  },
  {
    id: "assistant",
    name: "Strategy Assistant & research",
    accent: "fuchsia",
    blurb:
      "Two ways to improve the strategy on your own data. Research is a " +
      "deterministic search job you start and poll. The Assistant is an LLM " +
      "agent (Anthropic or any OpenAI-compatible provider) with read-only tools " +
      "and a propose-only apply — it can suggest, but only you can approve.",
    modules: [
      {
        path: "server/agent.ts",
        role: "The LLM agent: provider config, tool definitions, and the propose-only run loop.",
        symbols: [
          "runAgent()",
          "getAgentConfig()",
          "saveAgentConfig()",
          "sanitizeModel()",
          "sanitizeBaseUrl()",
        ],
      },
      {
        path: "server/research.ts",
        role: "Long-running strategy-search jobs as a pollable state machine (download → search → report).",
        symbols: ["startRun()", "ResearchRun", "StartRunInput"],
      },
    ],
  },
  {
    id: "ui",
    name: "Dashboard (UI)",
    accent: "slate",
    blurb:
      "A React + Vite SPA served by the same process on the same origin. It " +
      "reads over REST, subscribes to the SSE stream to know when to refetch, " +
      "and edits everything — assets, indicators, risk, the MT5 bridge — through " +
      "the Settings page. Nothing here requires editing code.",
    modules: [
      {
        path: "src/lib/api.ts",
        role: "The typed client for every REST route and the shared config types.",
        symbols: ["api", "AppConfig", "Mt5Status"],
      },
      {
        path: "src/hooks/useLive.ts",
        role: "Fetch-and-resubscribe hook: refetches when the SSE stream names a topic it cares about.",
        symbols: ["useLive()"],
      },
      {
        path: "src/pages/SettingsPage.tsx",
        role: "The one place to configure the app — assets, strategy fields, risk, MT5.",
      },
      {
        path: "src/pages/ArchitecturePage.tsx",
        role: "This page: the baked-in architecture map.",
      },
    ],
  },
];

/**
 * The load-bearing flow, for the diagram. Each edge is a real call or import
 * relationship confirmed in the graph.
 */
export const ARCH_FLOW: ArchFlowEdge[] = [
  { from: "process", to: "engine", label: "runs on a timer" },
  { from: "process", to: "intel", label: "runs on a timer" },
  { from: "process", to: "mt5", label: "syncs on a timer" },
  { from: "engine", to: "strategy", label: "grades setups" },
  { from: "engine", to: "risk", label: "canTrade() + persists" },
  { from: "engine", to: "mt5", label: "executes armed orders" },
  { from: "mt5", to: "strategy", label: "measured cost model" },
  { from: "assistant", to: "strategy", label: "backtests / proposes" },
  { from: "ui", to: "process", label: "REST + SSE" },
];
