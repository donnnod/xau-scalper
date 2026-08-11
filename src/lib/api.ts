/**
 * Client for the local server.
 *
 * Replaces the generated Convex client. Same origin as the page — the server
 * serves both the UI and the API — so there is no URL to configure, no
 * deployment key, and no CORS.
 */

const BASE = "";

export class ApiError extends Error {
  // Declared as a field rather than a parameter property: the app's tsconfig
  // sets erasableSyntaxOnly, which forbids the constructor-parameter shorthand.
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init?.headers }
      : init?.headers,
  });

  if (!res.ok) {
    // Surface the server's own message where it gave one; a bare status code
    // tells the user nothing about what went wrong.
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(detail, res.status);
  }

  return (await res.json()) as T;
}

export const get = <T>(path: string) => request<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });
export const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

// ─── Shapes returned by the server ───

export interface IdeaEvent {
  event: string;
  price: number;
  timestamp: number;
}

export interface Idea {
  id: number;
  asset: string;
  direction: "LONG" | "SHORT";
  status: "ACTIVE" | "TP1_HIT" | "TP2_HIT" | "STOPPED" | "EXPIRED";
  source: string;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  trailingSl: number | null;
  confidence: number;
  grade: string | null;
  reason: string;
  timeframe: string;
  bias: string;
  biasStrength: number;
  spotPrice: number;
  teoScore: number | null;
  teoRegime: string | null;
  pnlPoints: number | null;
  createdAt: number;
  resolvedAt: number | null;
  events?: IdeaEvent[];
}

export interface JournalEntry {
  id: number;
  eventType: string;
  asset: string;
  source: string;
  ideaId: number | null;
  direction: "LONG" | "SHORT" | null;
  price: number | null;
  details: string;
  metadata: string | null;
  timestamp: number;
}

export type SignificanceVerdict =
  | "insufficient_data"
  | "indistinguishable_from_chance"
  | "significant";

/**
 * How much of a win rate is real, and how much could be luck.
 *
 * Served alongside the performance numbers rather than on its own endpoint, so
 * a win rate is never rendered without the sample size that qualifies it.
 */
export interface Significance {
  trades: number;
  wins: number;
  winRate: number;
  /** The rate that must be beaten to break even after costs. */
  breakevenRate: number;
  /** Probability of a result this good if the true edge were zero. */
  pValue: number;
  /** 95% Wilson interval on the true win rate. */
  interval: { low: number; high: number };
  verdict: SignificanceVerdict;
  /** Trades needed to resolve an edge of the observed size. null if none. */
  tradesNeeded: number | null;
  summary: string;
}

export interface PortfolioPosition {
  asset: string;
  direction: "LONG" | "SHORT";
  weight?: number;
}

export interface PairCorrelation {
  a: string;
  b: string;
  value: number;
  /** Overlapping bars behind the estimate. null when it was assumed. */
  samples: number | null;
  assumed: boolean;
}

/**
 * What the open positions are worth together.
 *
 * The per-asset view cannot see that five crypto longs are one bet at five
 * times the size; this is the view that can.
 */
export interface Portfolio {
  positions: PortfolioPosition[];
  /** Net signed exposure. Large magnitude = a directional bet, not a book. */
  netExposure: number;
  /** Sum of position sizes, blind to how they interact. */
  grossRisk: number;
  /** Risk in units of one independent position. */
  portfolioRisk: number;
  /** portfolioRisk / grossRisk. Near 1 = one bet in several costumes. */
  concentration: number;
  maxRisk: number;
  headroom: number;
  averageCorrelation: number;
  /** False when any pair fell back to an assumed correlation. */
  correlationsMeasured: boolean;
  summary: string;
  correlations: PairCorrelation[];
  evidence: {
    trades: number;
    wins: number;
    averageConcurrency: number;
    averageCorrelation: number;
    /** Trades discounted for having been held at the same time. */
    effectiveTrades: number;
    significance: Significance;
  };
}

export interface AssetPerformance {
  asset: string;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  /** Net points for THIS asset. Points are not comparable across instruments. */
  totalPnlPoints: number;
  avgWinPoints: number;
  avgLossPoints: number;
  /** Average win divided by average loss. null when there are no losses. */
  avgRR: number | null;
  maxWinStreak: number;
  maxLossStreak: number;
  /** Positive = consecutive wins, negative = consecutive losses. */
  currentStreak: number;
  /** null when there were no losing trades — the ratio is undefined, not zero. */
  profitFactor: number | null;
  significance: Significance;
}

export interface ManualTrade {
  id: number;
  asset: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "WIN" | "LOSS" | "BREAKEVEN";
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  riskAmount: number | null;
  pnlPoints: number | null;
  pnlDollars: number | null;
  notes: string | null;
  openedAt: number;
  closedAt: number | null;
}

export interface TradeStats {
  totalTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  netDollars: number;
  totalPnlPoints: number;
  avgWinDollars: number;
  avgLossDollars: number;
  /** null when there were no losing trades — the ratio is undefined, not zero. */
  profitFactor: number | null;
}

export interface AssetInfo {
  id: string;
  symbol: string;
  precision: number;
  enabled: boolean;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Execution / accounts ───

export type RiskConfig =
  | {
      mode: "fixed_fraction";
      riskPct: number;
      equity: number;
      contractSize?: number;
      lotStep?: number;
      minLot?: number;
      maxLots?: number;
    }
  | { mode: "fixed_lot"; lots: number };

export interface Account {
  id: number;
  label: string;
  mode: "demo" | "live";
  symbol: string;
  terminalDir: string | null;
  execution: "auto" | "manual";
  enabled: boolean;
  risk: RiskConfig;
  createdAt: number;
  updatedAt: number;
}

export interface AccountInput {
  label: string;
  mode: "demo" | "live";
  symbol?: string;
  terminalDir?: string | null;
  execution?: "auto" | "manual";
  enabled?: boolean;
  risk: RiskConfig;
}

export interface ExecutionOrder {
  id: number;
  accountId: number;
  ideaId: number | null;
  clientId: string;
  action: "OPEN" | "CLOSE";
  direction: "LONG" | "SHORT" | null;
  symbol: string;
  lots: number;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  status: "PENDING" | "SENT" | "FILLED" | "REJECTED" | "ERROR" | "CANCELLED";
  ticket: number | null;
  fillPrice: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

// ─── Endpoints ───

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") s.set(k, String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : "";
};

export const api = {
  assets: () => get<{ assets: AssetInfo[] }>("/api/assets"),

  ideas: (opts: { asset?: string; limit?: number } = {}) =>
    get<{ ideas: Idea[] }>(`/api/ideas${q(opts)}`),
  openIdeas: (opts: { asset?: string } = {}) =>
    get<{ ideas: Idea[] }>(`/api/ideas/open${q(opts)}`),
  logIdea: (body: Record<string, unknown>) =>
    post<{ ok: true; id: number }>("/api/ideas", body),
  deleteIdea: (id: number) => del<{ ok: true }>(`/api/ideas/${id}`),

  journal: (opts: { asset?: string; limit?: number } = {}) =>
    get<{ entries: JournalEntry[] }>(`/api/journal${q(opts)}`),
  journalCounts: () => get<Record<string, number>>("/api/journal/counts"),

  performance: (opts: { asset?: string } = {}) =>
    get<{ byAsset: AssetPerformance[] }>(`/api/performance${q(opts)}`),

  portfolio: () => get<Portfolio>("/api/portfolio"),

  candles: (asset: string, interval = "5m", limit = 200) =>
    get<{ asset: string; interval: string; candles: Candle[] }>(
      `/api/candles${q({ asset, interval, limit })}`,
    ),

  trades: (opts: { limit?: number } = {}) =>
    get<{ trades: ManualTrade[] }>(`/api/trades${q(opts)}`),
  tradeStats: () => get<TradeStats>("/api/trades/stats"),
  logTrade: (body: Record<string, unknown>) =>
    post<{ ok: true; id: number }>("/api/trades", body),
  closeTrade: (id: number, exitPrice: number) =>
    post<{ ok: true }>(`/api/trades/${id}`, { exitPrice }),
  deleteTrade: (id: number) => del<{ ok: true }>(`/api/trades/${id}`),

  /** Intel state written by the engines: regime, macro, news, sweeps. */
  state: <T>(key: string) => get<T>(`/api/state/${key}`),

  health: () =>
    get<{
      ok: boolean;
      openIdeas: number;
      lastSignalRun: number | null;
      lastMonitorRun: number | null;
    }>("/api/health"),

  // ─── Execution / accounts ───
  presets: () =>
    get<{ presets: Record<string, RiskConfig> }>("/api/execution/presets"),
  accounts: () => get<{ accounts: Account[] }>("/api/accounts"),
  createAccount: (body: AccountInput) =>
    post<{ account: Account }>("/api/accounts", body),
  updateAccount: (id: number, body: Partial<AccountInput>) =>
    patch<{ account: Account }>(`/api/accounts/${id}`, body),
  deleteAccount: (id: number) => del<{ ok: true }>(`/api/accounts/${id}`),

  orders: (opts: { limit?: number } = {}) =>
    get<{ orders: ExecutionOrder[] }>(`/api/orders${q(opts)}`),
  sendOrder: (ideaId: number, accountId: number) =>
    post<{ result: unknown }>("/api/orders", { ideaId, accountId }),
  closeOrder: (orderId: number) =>
    post<{ result: unknown }>("/api/orders/close", { orderId }),
};
