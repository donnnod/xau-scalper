/**
 * Strategy Assistant — a chat with a Claude agent that can inspect stored
 * datasets, run backtests, tune parameters, and propose a strategy to apply.
 *
 * The agent never writes anything: any "apply" it suggests arrives as a
 * proposal card with an Approve button, and approving calls the same
 * human-gated endpoint the Find Strategies page uses. Nothing reaches the
 * engine without a click here.
 */

import { Bot, CheckCircle2, Loader2, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type AgentProposal, type AgentTurn, ApiError, api } from "@/lib/api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  log?: string[];
  proposals?: AgentProposal[];
}

const SUGGESTIONS = [
  "What datasets do I have to work with?",
  "Backtest the default strategy on my uploaded data and tell me if it has an edge.",
  "Tune the strategy for my uploaded pair and propose the best config you find.",
];

function ProposalCard({ proposal }: { proposal: AgentProposal }) {
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const approve = async () => {
    setApplying(true);
    try {
      const { assetId, added } = await api.applyStrategy({
        symbol: proposal.symbol,
        config: proposal.config,
        precision: proposal.precision,
        interval: proposal.interval,
      });
      setApplied(true);
      toast.success(
        added
          ? `Added ${assetId} to the engine (disabled). Enable it in Settings to trade it.`
          : `Updated ${assetId}'s strategy.`,
      );
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Could not apply the strategy.",
      );
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-[#D4A843]/40 bg-[#D4A843]/5 p-3">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-xs font-mono font-bold text-[#D4A843]">
          Proposed: {proposal.symbol} {proposal.interval}
        </span>
        <Button
          size="sm"
          onClick={approve}
          disabled={applying || applied}
          className="h-7"
        >
          {applied ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : applying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          {applied ? "Applied" : "Approve & apply"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground leading-snug mb-2">
        {proposal.summary}
      </p>
      <details className="text-[11px]">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Parameters
        </summary>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 mt-1 font-mono">
          {Object.entries(proposal.config).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-muted-foreground truncate">{k}</span>
              <span>{String(v)}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export function AgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const history: AgentTurn[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
    setMessages(prev => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setBusy(true);
    try {
      const result = await api.agentMessage(trimmed, history);
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: result.reply || "(no reply)",
          log: result.log,
          proposals: result.proposals,
        },
      ]);
    } catch (e) {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content:
            e instanceof ApiError
              ? `⚠ ${e.message}`
              : "⚠ The agent could not be reached.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] max-w-3xl mx-auto w-full p-3 sm:p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#7C5CFF] to-[#4A2FB0] flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Strategy Assistant</h1>
          <p className="text-[11px] text-muted-foreground">
            Researches and tunes strategies on your data. It can propose — you
            approve. It never changes config or arms trading on its own.
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Bot className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              Ask the assistant to backtest or tune a strategy on your data.
            </p>
            <div className="flex flex-col gap-2 w-full max-w-md">
              {SUGGESTIONS.map(s => (
                <button
                  type="button"
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-xs rounded-lg border border-border bg-card px-3 py-2 text-muted-foreground hover:text-foreground hover:border-[#7C5CFF]/40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className="flex gap-3">
            <div
              className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                m.role === "user" ? "bg-secondary" : "bg-[#7C5CFF]/15"
              }`}
            >
              {m.role === "user" ? (
                <User className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Bot className="h-4 w-4 text-[#7C5CFF]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {m.content}
              </p>
              {m.log && m.log.length > 0 && (
                <details className="mt-1.5 text-[11px] text-muted-foreground/70">
                  <summary className="cursor-pointer hover:text-foreground">
                    {m.log.length} tool action(s)
                  </summary>
                  <ul className="mt-1 space-y-0.5 font-mono">
                    {m.log.map((line, j) => (
                      <li key={j}>· {line}</li>
                    ))}
                  </ul>
                </details>
              )}
              {m.proposals?.map((p, j) => (
                <ProposalCard key={j} proposal={p} />
              ))}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#7C5CFF]/15 shrink-0">
              <Bot className="h-4 w-4 text-[#7C5CFF]" />
            </div>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mt-1.5" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form
        className="flex items-center gap-2 pt-3 shrink-0"
        onSubmit={e => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask the assistant to backtest or tune a strategy…"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
