"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ChatEventWire, SerializedPendingApproval, ApprovalChoice } from "@/lib/approval-protocol";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
};

type StatusResp = { ok?: boolean; bridgeUp?: boolean; running?: boolean };
type HistoryResp = { events?: ChatEventWire[] };
type ApprovalsResp = { ok?: boolean; pending?: SerializedPendingApproval[] };
type SendResp = { ok: boolean; reason?: string };

const APPROVAL_POLL_MS = 3000;

let seq = 0;
const nextId = () => `msg-${++seq}`;

/** Short, human-scannable preview of a tool call's args for the inline approval card. */
function summarizeArgs(args: Record<string, unknown>): string {
  let json: string;
  try {
    json = JSON.stringify(args);
  } catch {
    return "(unserializable args)";
  }
  const MAX = 140;
  return json.length > MAX ? `${json.slice(0, MAX)}…` : json;
}

/** Folds one incoming ChatEventWire into the running message list — coalescing
 * assistant_delta into the current streaming bubble and having assistant_final replace it. */
function applyEvent(prev: ChatMessage[], ev: ChatEventWire): ChatMessage[] {
  const last = prev[prev.length - 1];
  switch (ev.kind) {
    case "user":
      return [...prev, { id: nextId(), role: "user", text: ev.text }];
    case "assistant_delta":
      if (last && last.role === "assistant" && last.streaming) {
        return [...prev.slice(0, -1), { ...last, text: last.text + ev.text }];
      }
      return [...prev, { id: nextId(), role: "assistant", text: ev.text, streaming: true }];
    case "assistant_final":
      if (last && last.role === "assistant" && last.streaming) {
        return [...prev.slice(0, -1), { ...last, text: ev.text, streaming: false }];
      }
      return [...prev, { id: nextId(), role: "assistant", text: ev.text }];
    case "rejected":
      return [...prev, { id: nextId(), role: "system", text: `Rejected (${ev.channel}): ${ev.reason}` }];
    case "status":
      // A run error surfaces as `idle` + `detail` (the bridge is still up —
      // see ChatChannelManager) rather than `offline`. Surface it as a cheap
      // transient system bubble instead of silently dropping it; a plain
      // `idle`/`running`/`offline` transition with no detail stays a no-op.
      if (ev.state === "idle" && ev.detail) {
        return [...prev, { id: nextId(), role: "system", text: ev.detail }];
      }
      return prev;
    default:
      return prev;
  }
}

function ApprovalMiniCard(
  { approval, onResolve }:
  { approval: SerializedPendingApproval; onResolve: (id: string, choice: ApprovalChoice) => Promise<void> }
) {
  const [busy, setBusy] = useState(false);
  const act = async (choice: ApprovalChoice) => {
    setBusy(true);
    await onResolve(approval.id, choice);
    setBusy(false);
  };
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <span className="font-mono text-[var(--color-fg)]">{approval.tool}</span>
          <div className="mt-0.5 truncate font-mono text-xs text-[var(--color-muted-foreground)]">
            {summarizeArgs(approval.args)}
          </div>
        </div>
        {approval.origin === "telegram" && <Badge kind="neutral">requested from Telegram</Badge>}
      </div>
      <div className="mt-2 flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => act("allow_once")}>Allow once</Button>
        <Button variant="danger" disabled={busy} onClick={() => act("deny")}><span aria-hidden>⛔</span> Deny</Button>
      </div>
    </Card>
  );
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [offline, setOffline] = useState(false);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<SerializedPendingApproval[]>([]);

  // Seed-vs-SSE race guards: the one-shot history/status fetches can resolve AFTER
  // live SSE events have already been folded (e.g. page refresh mid-run). The live
  // stream is always the fresher source, so a late-resolving seed must no-op rather
  // than clobber streamed deltas or tear down `running`. Two refs because a status
  // event arriving first shouldn't block the (independent) history seed, and vice versa.
  const liveEventSeenRef = useRef(false);   // any conversation event folded from SSE
  const liveStatusSeenRef = useRef(false);  // any status event applied from SSE
  // Hard send lock — set synchronously before the fetch so a rapid double-Enter
  // can't double-POST (React state (`sending`) flushes too late for same-tick repeats).
  const sendingRef = useRef(false);

  // Seed history + status once, then let the SSE stream carry live updates.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = (await fetch("/api/chat/history?limit=100", { cache: "no-store" }).then((x) => x.json())) as HistoryResp;
        if (!cancelled && Array.isArray(r.events)) {
          const seeded = r.events.reduce(applyEvent, [] as ChatMessage[]);
          // Functional update: skip the seed if the live stream got here first.
          setMessages((prev) => (liveEventSeenRef.current ? prev : seeded));
        }
      } catch {
        /* history is best-effort — the live stream still works without it */
      }
      try {
        const s = (await fetch("/api/chat/status", { cache: "no-store" }).then((x) => x.json())) as StatusResp;
        if (!cancelled && !liveStatusSeenRef.current) {
          setOffline(s.ok === false || s.bridgeUp === false);
          setRunning(Boolean(s.running));
        }
      } catch {
        if (!cancelled && !liveStatusSeenRef.current) setOffline(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Live conversation stream.
  useEffect(() => {
    const es = new EventSource("/api/chat/stream");
    es.onmessage = (e: MessageEvent<string>) => {
      let ev: ChatEventWire;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.kind === "status") {
        liveStatusSeenRef.current = true;
        setOffline(ev.state === "offline");
        setRunning(ev.state === "running");
        // A status event only touches the message list when it carries a
        // detail worth surfacing (e.g. a run error) — applyEvent's "status"
        // case is a no-op otherwise, so this can't spuriously insert bubbles
        // for ordinary idle/running/offline transitions.
        if (ev.detail) setMessages((prev) => applyEvent(prev, ev));
        return;
      }
      liveEventSeenRef.current = true;
      setMessages((prev) => applyEvent(prev, ev));
    };
    return () => es.close();
  }, []);

  // Inline approvals: only worth polling while a run is actually active.
  // When the run ends, drop any cards immediately — the proxy expires them
  // server-side, and a stale card here could invite a click on a dead approval.
  useEffect(() => {
    if (!running) {
      setPending([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const r = (await fetch("/api/approvals", { cache: "no-store" }).then((x) => x.json())) as ApprovalsResp;
        if (!cancelled && Array.isArray(r.pending)) setPending(r.pending);
      } catch {
        /* approvals are best-effort while polling; next tick re-syncs */
      }
    };
    tick();
    const t = setInterval(tick, APPROVAL_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [running]);

  const resolveApproval = useCallback(async (id: string, choice: ApprovalChoice) => {
    try {
      const res = await fetch("/api/approvals/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, choice }),
      });
      const body = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
      if (res.ok && body.ok) {
        setPending((prev) => prev.filter((p) => p.id !== id));
      }
    } catch {
      /* leave the card up; the next poll re-syncs the real state */
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || offline || sendingRef.current) return;
    sendingRef.current = true;
    setSendError(null);
    setSending(true);
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = (await res.json().catch(() => ({ ok: false }))) as SendResp;
      if (body.ok) {
        setInput("");
      } else {
        setSendError(body.reason ?? "Message was rejected.");
      }
    } catch {
      setSendError("Couldn't reach the assistant.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [input, offline]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      {offline && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-xl border border-[var(--color-deny)]/50 bg-[var(--color-deny)]/10 p-3 text-sm text-[var(--color-deny)]"
        >
          Assistant offline — the bridge isn&apos;t reachable. Messages won&apos;t send until it&apos;s back.
        </div>
      )}

      <ul aria-label="Conversation" className="flex flex-col gap-2">
        {messages.map((m) => (
          <li key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "system" ? (
              <span className="mx-auto text-xs text-[var(--color-muted-foreground)]">{m.text}</span>
            ) : (
              <div
                className={`max-w-[75%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
                    : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]"
                }`}
              >
                {m.text}
                {m.streaming && <span aria-hidden className="ml-1 animate-pulse">▍</span>}
              </div>
            )}
          </li>
        ))}
      </ul>

      {pending.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {pending.map((p) => (
            <ApprovalMiniCard key={p.id} approval={p} onResolve={resolveApproval} />
          ))}
        </div>
      )}

      {sendError && (
        <div role="alert" className="mt-2 text-xs text-[var(--color-deny)]">{sendError}</div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <input
          aria-label="Message"
          type="text"
          value={input}
          disabled={offline || sending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={offline ? "Assistant offline" : "Message your agent…"}
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus-visible:border-[var(--color-accent)] disabled:opacity-50"
        />
        <Button variant="primary" disabled={offline || sending || !input.trim()} onClick={send}>
          Send
        </Button>
      </div>
    </div>
  );
}
