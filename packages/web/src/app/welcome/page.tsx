"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { CommandBlock } from "@/components/command-block";
import { downstreamAddCommand, agentAddCommand, type SetupStatus } from "@/lib/setup-status";

const POLL_MS = 2000;
const EMPTY: SetupStatus = { configExists: false, downstreams: [], agents: [], telegramConfigured: false, proxyRunning: false, decisionCount: 0 };

const TARGETS = [
  { id: "openclaw", label: "OpenClaw", installable: true },
  { id: "hermes", label: "Hermes", installable: false },
  { id: "claude-desktop", label: "Claude Desktop", installable: false },
  { id: "manual", label: "Guard tools manually", installable: false },
];

function StepShell({ n, title, done, staticStep, children }: { n: number; title: string; done?: boolean; staticStep?: boolean; children: React.ReactNode }) {
  const isDone = !staticStep && Boolean(done);
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
            isDone ? "bg-[var(--color-allow)] text-black" : "border border-[var(--color-border)] text-[var(--color-muted-foreground)]"
          }`}
        >
          {isDone ? "✓" : n}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        {isDone && <span className="text-xs text-[var(--color-allow)]">done</span>}
      </div>
      <div className="mt-3 pl-7 text-sm text-[var(--color-muted-foreground)]">{children}</div>
    </Card>
  );
}

export default function Welcome() {
  const [status, setStatus] = useState<SetupStatus>(EMPTY);
  const [target, setTarget] = useState("openclaw");
  const [path, setPath] = useState("~/workspace");
  const [budget, setBudget] = useState(30);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = (await fetch("/api/setup-status", { cache: "no-store" }).then((r) => r.json())) as SetupStatus;
        if (!cancelled) setStatus(s);
      } catch { /* keep last status */ }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const agentName = target === "manual" ? "my-agent" : target;
  const installable = TARGETS.find((t) => t.id === target)?.installable ?? false;
  const allDone = status.configExists && status.downstreams.length > 0 && status.agents.length > 0 && status.proxyRunning && status.decisionCount > 0;

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Welcome to Habena</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Five steps to a guarded agent. Run each command in your terminal — this page detects each step as you go.
        </p>
      </header>

      {allDone && (
        <div className="mb-4 rounded-lg border border-[var(--color-allow)]/50 bg-[var(--color-allow)]/10 p-4 text-sm text-[var(--color-allow)]">
          ✓ It works — your agent is guarded. See it in <a href="/decisions" className="underline">Decisions</a>.
        </div>
      )}

      <div className="flex flex-col gap-3">
        <StepShell n={1} title="Pick what you're guarding" staticStep>
          <div className="flex flex-wrap gap-2">
            {TARGETS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTarget(t.id)}
                aria-pressed={target === t.id}
                className={`rounded border px-2 py-1 text-xs ${
                  target === t.id ? "border-[var(--color-accent)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {!installable && target !== "openclaw" && (
            <p className="mt-2 text-xs">No one-click installer yet — after setup, point {agentName} at Habena as its MCP server.</p>
          )}
        </StepShell>

        <StepShell n={2} title="Initialize" done={status.configExists}>
          <p className="mb-2">Creates <code>~/.habena/config.yaml</code> with the safe <strong>cautious</strong> preset.</p>
          <CommandBlock command="habena init" />
        </StepShell>

        <StepShell n={3} title="Wire a downstream" done={status.downstreams.length > 0}>
          <label className="mb-2 flex items-center gap-2 text-xs">Folder to expose
            <input value={path} onChange={(e) => setPath(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono" />
          </label>
          <CommandBlock command={downstreamAddCommand(path)} />
        </StepShell>

        <StepShell n={4} title="Register your agent" done={status.agents.length > 0}>
          <label className="mb-2 flex items-center gap-2 text-xs">Daily budget ($)
            <input type="number" aria-label="daily budget" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono" />
          </label>
          <CommandBlock command={agentAddCommand(agentName, budget)} />
          {installable && (
            <div className="mt-2">
              <p className="mb-1 text-xs">Then wire {agentName} to use Habena (backs up its config first):</p>
              <CommandBlock command={`habena install ${agentName}`} />
            </div>
          )}
        </StepShell>

        <StepShell n={5} title="Start & prove it" done={status.proxyRunning && status.decisionCount > 0}>
          <p className="mb-2">Start the proxy{status.proxyRunning ? " — running ✓" : ""}, then trigger a tool call and watch it appear in <a href="/decisions" className="underline">Decisions</a>.</p>
          <CommandBlock command="habena start" />
          {status.proxyRunning && status.decisionCount === 0 && (
            <p className="mt-2 text-xs">Proxy is up — waiting for the first tool call…</p>
          )}
        </StepShell>
      </div>
    </main>
  );
}
