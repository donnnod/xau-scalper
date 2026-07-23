import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

declare const process: { env: Record<string, string | undefined> };

const http = httpRouter();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Binance klines proxy (via data-api.binance.vision — no geo-restrictions) ──
http.route({
  path: "/api/klines",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol") || "PAXGUSDT";
    const interval = url.searchParams.get("interval") || "5m";
    const limit = url.searchParams.get("limit") || "200";

    try {
      const apiUrl = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(apiUrl);
      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }),
});

http.route({
  path: "/api/klines",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

// ── Binance 24hr ticker proxy ──
http.route({
  path: "/api/ticker",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol") || "PAXGUSDT";

    try {
      const apiUrl = `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${symbol}`;
      const res = await fetch(apiUrl);
      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }),
});

http.route({
  path: "/api/ticker",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

// ── Gold spot price proxy ──
http.route({
  path: "/api/gold-price",
  method: "GET",
  handler: httpAction(async () => {
    // 1. Try goldprice.org
    try {
      const res = await fetch("https://data-asg.goldprice.org/dbXRates/USD");
      if (res.ok) {
        const data = await res.text();
        return new Response(
          JSON.stringify({ source: "goldprice.org", data: JSON.parse(data) }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    } catch {
      // fall through
    }

    // 2. Binance PAXG as fallback (via binance.vision)
    try {
      const res = await fetch(
        "https://data-api.binance.vision/api/v3/ticker/24hr?symbol=PAXGUSDT",
      );
      if (res.ok) {
        const data = await res.text();
        return new Response(
          JSON.stringify({ source: "binance", data: JSON.parse(data) }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    } catch {
      // fall through
    }

    return new Response(JSON.stringify({ error: "All price sources failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/gold-price",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

// ── Teo forward-test proposal endpoint ──
// POST /teo/propose — Teo submits a trade proposal before outcome is known.
// Optional auth: set TEO_API_KEY env var; if set, request body must include { apiKey: "..." }.
http.route({
  path: "/teo/propose",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();

      // Optional API key auth
      const expectedKey = process.env.TEO_API_KEY;
      if (expectedKey && body.apiKey !== expectedKey) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await ctx.runMutation(internal.forwardTest.proposeTrade, {
        symbol: String(body.symbol ?? "UNKNOWN"),
        direction: body.direction === "SHORT" ? "SHORT" : "LONG",
        entryPrice: Number(body.entryPrice),
        stopLoss: Number(body.stopLoss),
        tp1: Number(body.tp1),
        tp2: Number(body.tp2),
        confidence: Number(body.confidence ?? 70),
        reason: String(body.reason ?? ""),
        timeframe: String(body.timeframe ?? "5m"),
        teoScore:
          body.teoScore !== undefined ? Number(body.teoScore) : undefined,
        teoRegime:
          body.teoRegime !== undefined ? String(body.teoRegime) : undefined,
      });

      return new Response(
        JSON.stringify({ ideaId: result.ideaId, status: "queued" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }),
});

http.route({
  path: "/teo/propose",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

export default http;
