/**
 * Architecture — the app explaining itself.
 *
 * A baked-in snapshot of the code graph (see src/lib/architecture.ts): the
 * subsystems, the files that carry each one, and the real flow between them.
 * It needs no external service and no network call — the point is that anyone
 * running the app can see what is in it and how it fits together, offline.
 */

import { GitBranch, Network } from "lucide-react";
import {
  ARCH_FLOW,
  ARCH_PROVENANCE,
  ARCH_SUBSYSTEMS,
  type ArchSubsystem,
} from "@/lib/architecture";

/** Static Tailwind classes per accent, so nothing is purged at build time. */
const ACCENT: Record<
  string,
  { border: string; text: string; bg: string; hex: string }
> = {
  amber: {
    border: "border-amber-500/40",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    hex: "#f59e0b",
  },
  sky: {
    border: "border-sky-500/40",
    text: "text-sky-400",
    bg: "bg-sky-500/10",
    hex: "#0ea5e9",
  },
  emerald: {
    border: "border-emerald-500/40",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    hex: "#10b981",
  },
  rose: {
    border: "border-rose-500/40",
    text: "text-rose-400",
    bg: "bg-rose-500/10",
    hex: "#f43f5e",
  },
  violet: {
    border: "border-violet-500/40",
    text: "text-violet-400",
    bg: "bg-violet-500/10",
    hex: "#8b5cf6",
  },
  cyan: {
    border: "border-cyan-500/40",
    text: "text-cyan-400",
    bg: "bg-cyan-500/10",
    hex: "#06b6d4",
  },
  fuchsia: {
    border: "border-fuchsia-500/40",
    text: "text-fuchsia-400",
    bg: "bg-fuchsia-500/10",
    hex: "#d946ef",
  },
  slate: {
    border: "border-slate-500/40",
    text: "text-slate-300",
    bg: "bg-slate-500/10",
    hex: "#94a3b8",
  },
};

const accentOf = (a: string) => ACCENT[a] ?? ACCENT.slate;

/** Hand-placed positions for the flow diagram, keyed by subsystem id. */
const POS: Record<string, { x: number; y: number }> = {
  ui: { x: 40, y: 20 },
  process: { x: 330, y: 20 },
  intel: { x: 620, y: 20 },
  engine: { x: 330, y: 150 },
  mt5: { x: 620, y: 150 },
  strategy: { x: 180, y: 280 },
  risk: { x: 480, y: 280 },
  assistant: { x: 40, y: 150 },
};

const BOX_W = 190;
const BOX_H = 62;

function FlowDiagram() {
  const center = (id: string) => {
    const p = POS[id];
    return { cx: p.x + BOX_W / 2, cy: p.y + BOX_H / 2 };
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card/40 p-2">
      <svg
        viewBox="0 0 830 372"
        className="min-w-[820px] w-full h-auto"
        role="img"
        aria-label="Subsystem flow diagram"
      >
        <title>How the subsystems connect</title>
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* Edges first, so boxes paint on top. */}
        <g className="text-muted-foreground">
          {ARCH_FLOW.map(e => {
            const a = center(e.from);
            const b = center(e.to);
            const mx = (a.cx + b.cx) / 2;
            const my = (a.cy + b.cy) / 2;
            return (
              <g key={`${e.from}-${e.to}`}>
                <line
                  x1={a.cx}
                  y1={a.cy}
                  x2={b.cx}
                  y2={b.cy}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeOpacity="0.35"
                  markerEnd="url(#arrow)"
                />
                <text
                  x={mx}
                  y={my - 3}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize="9"
                >
                  {e.label}
                </text>
              </g>
            );
          })}
        </g>

        {/* Subsystem boxes. */}
        {ARCH_SUBSYSTEMS.map(s => {
          const p = POS[s.id];
          if (!p) return null;
          const c = accentOf(s.accent);
          return (
            <g key={s.id}>
              <rect
                x={p.x}
                y={p.y}
                width={BOX_W}
                height={BOX_H}
                rx="8"
                fill={`${c.hex}1a`}
                stroke={c.hex}
                strokeWidth="1.5"
              />
              <text
                x={p.x + 12}
                y={p.y + 24}
                fontSize="13"
                fontWeight="600"
                fill={c.hex}
              >
                {s.name}
              </text>
              <text
                x={p.x + 12}
                y={p.y + 44}
                fontSize="10"
                className="fill-muted-foreground"
              >
                {s.modules.length} module
                {s.modules.length === 1 ? "" : "s"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SubsystemCard({ s }: { s: ArchSubsystem }) {
  const c = accentOf(s.accent);
  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-4`}>
      <h3 className={`text-sm font-semibold ${c.text}`}>{s.name}</h3>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        {s.blurb}
      </p>
      <div className="mt-3 space-y-2">
        {s.modules.map(m => (
          <div key={m.path} className="rounded-md bg-background/40 p-2">
            <code className="text-xs font-medium text-foreground">
              {m.path}
            </code>
            <p className="text-xs text-muted-foreground mt-0.5">{m.role}</p>
            {m.symbols && m.symbols.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {m.symbols.map(sym => (
                  <span
                    key={sym}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground"
                  >
                    {sym}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ArchitecturePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Network className="w-5 h-5 text-[#D4A843]" />
          Architecture
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          What is in this app and how it fits together — a baked-in snapshot of
          the code graph, no external service required.
        </p>
      </div>

      <FlowDiagram />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ARCH_SUBSYSTEMS.map(s => (
          <SubsystemCard key={s.id} s={s} />
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
        <GitBranch className="w-3 h-3" />
        Snapshot of the promoted code graph at commit{" "}
        <code className="font-mono">{ARCH_PROVENANCE.commit}</code> —{" "}
        {ARCH_PROVENANCE.nodes.toLocaleString()} symbols,{" "}
        {ARCH_PROVENANCE.edges.toLocaleString()} edges across{" "}
        {ARCH_PROVENANCE.communities} communities. Regenerate when the code
        moves.
      </p>
    </div>
  );
}

export default ArchitecturePage;
