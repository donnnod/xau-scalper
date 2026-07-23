import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

// ─── proposeTrade ─────────────────────────────────────────────────────────────
// Called by the HTTP /teo/propose endpoint to submit a Teo forward-test trade
// proposal *before* its outcome is known. The existing monitorIdeas cron
// resolves it naturally as price moves — no extra wiring needed.
export const proposeTrade = internalMutation({
  args: {
    symbol: v.string(),
    direction: v.union(v.literal("LONG"), v.literal("SHORT")),
    entryPrice: v.number(),
    stopLoss: v.number(),
    tp1: v.number(),
    tp2: v.number(),
    confidence: v.number(),
    reason: v.string(),
    timeframe: v.string(),
    teoScore: v.optional(v.number()),
    teoRegime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const id = await ctx.db.insert("tradingIdeas", {
      direction: args.direction,
      entryPrice: args.entryPrice,
      stopLoss: args.stopLoss,
      tp1: args.tp1,
      tp2: args.tp2,
      confidence: args.confidence,
      reason: `[Teo/${args.symbol}] ${args.reason}`,
      timeframe: args.timeframe,
      bias: args.direction === "LONG" ? "BULLISH" : "BEARISH",
      biasStrength: Math.round(args.confidence),
      spotPrice: args.entryPrice,
      status: "ACTIVE",
      source: "teo",
      teoScore: args.teoScore,
      teoRegime: args.teoRegime,
      createdAt: now,
      journeyLog: [
        { event: "SIGNAL_GENERATED", price: args.entryPrice, timestamp: now },
      ],
    });

    // Immutable audit trail — written before any outcome is known
    await ctx.db.insert("signalJournal", {
      eventType: "SIGNAL_GENERATED",
      ideaId: id,
      direction: args.direction,
      price: args.entryPrice,
      details: `[Teo] ${args.symbol} ${args.direction} @ ${args.entryPrice} | SL:${args.stopLoss} TP1:${args.tp1} TP2:${args.tp2} | regime:${args.teoRegime ?? "unknown"} score:${args.teoScore !== undefined ? args.teoScore.toFixed(2) : "n/a"}`,
      metadata: JSON.stringify({
        symbol: args.symbol,
        teoScore: args.teoScore,
        teoRegime: args.teoRegime,
      }),
      timestamp: now,
    });

    return { ideaId: id };
  },
});

// ─── getTrackRecord ───────────────────────────────────────────────────────────
// Returns running win-rate + PnL for any source (default: "teo").
// Use this to power the forward-test credibility display on PerformanceTrackerPage.
export const getTrackRecord = query({
  args: {
    source: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { source, limit }) => {
    const src = (source ?? "teo") as
      | "teo"
      | "engine"
      | "dashboard"
      | "experimental";

    const ideas = await ctx.db
      .query("tradingIdeas")
      .withIndex("by_source_created", q => q.eq("source", src))
      .order("desc")
      .take(limit ?? 50);

    const closed = ideas.filter(i =>
      ["TP1_HIT", "TP2_HIT", "STOPPED"].includes(i.status),
    );
    const wins = closed.filter(i =>
      ["TP1_HIT", "TP2_HIT"].includes(i.status),
    ).length;
    const totalPnlPoints = closed.reduce((s, i) => s + (i.pnlPoints ?? 0), 0);

    return {
      ideas,
      winRate: closed.length > 0 ? wins / closed.length : null,
      totalPnlPoints,
      closed: closed.length,
      total: ideas.length,
    };
  },
});
