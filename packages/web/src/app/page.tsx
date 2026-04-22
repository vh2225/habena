"use client";
import { useEffect, useState } from "react";

type Decision = {
  id: number;
  timestamp: string;
  agentType: string;
  instanceId: string;
  tool: string;
  mcpServer: string;
  decision: string;
  tier: string;
  ruleMatched: string | null;
  reason: string | null;
  latencyMs: number | null;
  resultStatus: string;
};

type Summary = {
  totalDecisions: number;
  allowed: number;
  denied: number;
  approvalPending: number;
  byAgent: Array<{ agentType: string; count: number }>;
  byTool: Array<{ tool: string; count: number }>;
};

type DecisionsResp = { ok: boolean; reason?: string; hint?: string; rows: Decision[] };
type SummaryResp = { ok: boolean; reason?: string; hint?: string; summary: Summary | null };

const POLL_MS = 2000;

export default function Dashboard() {
  const [rows, setRows] = useState<Decision[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const [dResp, sResp] = await Promise.all([
          fetch("/api/decisions?limit=100", { cache: "no-store" }).then(
            (r) => r.json() as Promise<DecisionsResp>
          ),
          fetch("/api/summary", { cache: "no-store" }).then(
            (r) => r.json() as Promise<SummaryResp>
          ),
        ]);
        if (cancelled) return;
        if (!dResp.ok) {
          setErr(dResp.reason ?? "unknown error");
          setHint(dResp.hint ?? null);
        } else {
          setErr(null);
          setHint(null);
        }
        setRows(dResp.rows ?? []);
        setSum(sResp.summary ?? null);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    }
    tick();
    const t = setInterval(() => {
      if (!paused) tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [paused]);

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>AgentGuard</h1>
          <div style={styles.subtitle}>local decision stream · {rows.length} rows</div>
        </div>
        <div style={styles.controls}>
          <label style={styles.pause}>
            <input
              type="checkbox"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
            />{" "}
            pause
          </label>
        </div>
      </header>

      {err && (
        <div style={styles.errBox}>
          <strong>Error:</strong> {err}
          {hint && <div style={styles.hint}>{hint}</div>}
        </div>
      )}

      {sum && (
        <section style={styles.stats}>
          <Stat label="Total decisions" value={sum.totalDecisions.toLocaleString()} />
          <Stat label="Allowed" value={sum.allowed.toLocaleString()} color="#2ecc71" />
          <Stat label="Denied" value={sum.denied.toLocaleString()} color="#e74c3c" />
          <Stat
            label="Require approval"
            value={sum.approvalPending.toLocaleString()}
            color="#f1c40f"
          />
        </section>
      )}

      <section style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>time</th>
              <th style={styles.th}>agent</th>
              <th style={styles.th}>tool</th>
              <th style={styles.th}>server</th>
              <th style={styles.th}>decision</th>
              <th style={styles.th}>tier</th>
              <th style={styles.th}>rule</th>
              <th style={styles.th}>latency</th>
              <th style={styles.th}>status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td style={styles.tdEmpty} colSpan={9}>
                  no decisions yet — waiting for the proxy to record traffic
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={styles.td}>{fmtTime(r.timestamp)}</td>
                <td style={styles.td}>
                  <span style={styles.mono}>{r.agentType}</span>
                  <div style={styles.muted}>{r.instanceId.slice(0, 8)}</div>
                </td>
                <td style={styles.td}>
                  <span style={styles.mono}>{r.tool}</span>
                </td>
                <td style={styles.td}>
                  <span style={styles.mono}>{r.mcpServer}</span>
                </td>
                <td style={styles.td}>
                  <DecisionBadge value={r.decision} />
                </td>
                <td style={styles.td}>
                  <span style={styles.muted}>{r.tier}</span>
                </td>
                <td style={styles.td}>
                  <span style={styles.muted}>{r.ruleMatched ?? "—"}</span>
                </td>
                <td style={styles.td}>
                  {r.latencyMs !== null ? `${r.latencyMs}ms` : "—"}
                </td>
                <td style={styles.td}>
                  <span style={styles.muted}>{r.resultStatus}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color: color ?? "#eaeaea" }}>{value}</div>
    </div>
  );
}

function DecisionBadge({ value }: { value: string }) {
  const color =
    value === "allow"
      ? "#2ecc71"
      : value === "deny"
      ? "#e74c3c"
      : value === "require_approval"
      ? "#f1c40f"
      : "#888";
  return (
    <span
      style={{
        ...styles.badge,
        backgroundColor: color + "22",
        color,
        borderColor: color + "66",
      }}
    >
      {value}
    </span>
  );
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    fontFamily:
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    background: "#0b0b0d",
    color: "#eaeaea",
    minHeight: "100vh",
    padding: "24px 32px",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  h1: { margin: 0, fontSize: 22, letterSpacing: 0.5 },
  subtitle: { color: "#888", fontSize: 12, marginTop: 4 },
  controls: { display: "flex", gap: 12, alignItems: "center" },
  pause: { color: "#aaa", fontSize: 12, userSelect: "none" },
  errBox: {
    background: "#2a0f0f",
    border: "1px solid #7a2a2a",
    color: "#ffb8b8",
    padding: 12,
    borderRadius: 6,
    marginBottom: 16,
    fontSize: 13,
  },
  hint: { color: "#c99", marginTop: 6, fontSize: 12 },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
    marginBottom: 24,
  },
  stat: {
    background: "#141417",
    border: "1px solid #23232a",
    borderRadius: 6,
    padding: "12px 14px",
  },
  statLabel: { color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { fontSize: 24, marginTop: 4, fontWeight: 600 },
  tableWrap: {
    background: "#141417",
    border: "1px solid #23232a",
    borderRadius: 6,
    overflow: "auto",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: "1px solid #23232a",
    color: "#888",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontSize: 11,
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #1a1a1f",
    verticalAlign: "top",
  },
  tdEmpty: {
    padding: "24px 12px",
    color: "#666",
    textAlign: "center",
  },
  mono: { color: "#eaeaea" },
  muted: { color: "#888", fontSize: 11 },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    border: "1px solid",
    fontSize: 11,
    fontWeight: 600,
  },
};
