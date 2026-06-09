"use client";
import { useEffect, useMemo, useState } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DecisionDrawer } from "@/components/decision-drawer";
import {
  fmtTime, fmtLatency, uniqueValues, matchesFilters, decisionKind, isThreat,
  type DecisionRow, type DecisionFilters,
} from "@/lib/dashboard";

type Resp = { ok: boolean; reason?: string; hint?: string; rows: DecisionRow[] };
const POLL_MS = 2000;
const DECISIONS = ["allow", "deny", "require_approval"];

export default function DecisionsPage() {
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [dense, setDense] = useState(true);
  const [selected, setSelected] = useState<DecisionRow | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filters, setFilters] = useState<DecisionFilters>({ agentType: "", decision: "", mcpServer: "", threatsOnly: false });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const agent = params.get("agent");
    const decision = params.get("decision");
    const threats = params.get("threats");
    setFilters((f) => ({
      ...f,
      ...(agent ? { agentType: agent } : {}),
      ...(decision && DECISIONS.includes(decision) ? { decision } : {}),
      ...(threats === "1" ? { threatsOnly: true } : {}),
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/decisions?limit=200", { cache: "no-store" }).then((x) => x.json())) as Resp;
        if (cancelled) return;
        setRows(r.rows ?? []);
        setHint(r.ok ? null : r.hint ?? r.reason ?? null);
      } catch (e) {
        if (!cancelled) setHint((e as Error).message);
      }
    }
    tick();
    const t = setInterval(() => { if (!paused) tick(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [paused]);

  const filtered = useMemo(() => rows.filter((r) => matchesFilters(r, filters)), [rows, filters]);
  const agents = useMemo(() => uniqueValues(rows, "agentType"), [rows]);
  const servers = useMemo(() => uniqueValues(rows, "mcpServer"), [rows]);

  const columns = useMemo<ColumnDef<DecisionRow>[]>(() => [
    { header: "Time", accessorKey: "timestamp", cell: (c) => <span className="text-[var(--color-muted-foreground)]">{fmtTime(c.getValue<string>())}</span> },
    { header: "Agent", accessorKey: "agentType", cell: (c) => <span className="font-mono">{c.getValue<string>()}</span> },
    { header: "Tool", accessorKey: "tool", cell: (c) => <span className="font-mono">{c.getValue<string>()}</span> },
    { header: "Server", accessorKey: "mcpServer", cell: (c) => <span className="font-mono text-[var(--color-muted-foreground)]">{c.getValue<string>()}</span> },
    { header: "Decision", accessorKey: "decision", cell: (c) => (
      <span className="inline-flex items-center gap-1">
        <Badge kind={decisionKind(c.getValue<string>())}>{c.getValue<string>()}</Badge>
        {isThreat(c.row.original) && <Badge kind="threat" />}
      </span>
    ) },
    { header: "Rule", accessorKey: "ruleMatched", cell: (c) => <span className="text-[var(--color-muted-foreground)]">{c.getValue<string>() ?? "—"}</span> },
    { header: "Latency", accessorKey: "latencyMs", cell: (c) => fmtLatency(c.getValue<number | null>()) },
  ], []);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const pad = dense ? "px-3 py-1.5" : "px-3 py-3";

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Decisions</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">{filtered.length} of {rows.length} shown</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
          <label className="flex items-center gap-1"><input type="checkbox" checked={dense} onChange={(e) => setDense(e.target.checked)} /> dense</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> pause</label>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1">Agent
          <select aria-label="agent" value={filters.agentType} onChange={(e) => setFilters((f) => ({ ...f, agentType: e.target.value }))} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5">
            <option value="">all</option>{agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Decision
          <select aria-label="decision" value={filters.decision} onChange={(e) => setFilters((f) => ({ ...f, decision: e.target.value }))} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5">
            <option value="">all</option>{DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Server
          <select aria-label="server" value={filters.mcpServer} onChange={(e) => setFilters((f) => ({ ...f, mcpServer: e.target.value }))} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5">
            <option value="">all</option>{servers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={filters.threatsOnly} onChange={(e) => setFilters((f) => ({ ...f, threatsOnly: e.target.checked }))} />
          threats only
        </label>
      </div>

      {hint && <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-muted-foreground)]">{hint}</div>}

      <div className="overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full text-xs">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} onClick={h.column.getToggleSortingHandler()}
                      className={`cursor-pointer border-b border-[var(--color-border)] text-left font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] ${pad}`}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-[var(--color-muted-foreground)]">
                {rows.length > 0 ? "No decisions match the current filters." : "No decisions yet — start your agent and tool calls stream here."}
              </td></tr>
            )}
            {table.getRowModel().rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => setSelected(r.original)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(r.original);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`View decision detail for ${r.original.tool}`}
                className="cursor-pointer border-b border-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]">
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className={`align-top ${pad}`}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DecisionDrawer row={selected} onClose={() => setSelected(null)} />
    </main>
  );
}
