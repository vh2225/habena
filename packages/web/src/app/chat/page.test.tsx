// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/** Minimal fake EventSource — jsdom doesn't ship one. Tests grab the latest
 * instance and call `.emit(obj)` to push a ChatEventWire down the wire. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

function lastEventSource(): FakeEventSource {
  const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  if (!es) throw new Error("no EventSource was constructed");
  return es;
}

const STATUS_ONLINE = { bridgeUp: true, running: false, disarmed: [], queueDepth: 0 };
const STATUS_OFFLINE = { ok: false, reason: "offline" };
const STATUS_RUNNING = { bridgeUp: true, running: true, disarmed: [], queueDepth: 0 };

type MockOverrides = {
  history?: unknown;
  status?: unknown;
  send?: unknown;
  approvals?: unknown;
};

function mockFetch(overrides: MockOverrides = {}) {
  return vi.fn((url: string) => {
    const u = String(url);
    if (u.includes("/api/chat/history")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.history ?? { events: [] }) });
    }
    if (u.includes("/api/chat/status")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.status ?? STATUS_ONLINE) });
    }
    if (u.includes("/api/chat/send")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.send ?? { ok: true }) });
    }
    if (u.includes("/api/approvals/respond")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    if (u.includes("/api/approvals")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.approvals ?? { ok: true, pending: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

describe("Chat page", () => {
  it("renders history on load", async () => {
    vi.stubGlobal("fetch", mockFetch({
      history: {
        events: [
          { kind: "user", channel: "web", text: "hello", at: "2026-01-01T00:00:00.000Z" },
          { kind: "assistant_final", text: "hi there", at: "2026-01-01T00:00:01.000Z" },
        ],
      },
    }));
    const ChatPage = (await import("./page")).default;
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });

  it("streams a user + assistant_delta + assistant_final sequence into bubbles", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const ChatPage = (await import("./page")).default;
    render(<ChatPage />);
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    const es = lastEventSource();

    es.emit({ kind: "user", channel: "web", text: "ping", at: "t" });
    await waitFor(() => expect(screen.getByText("ping")).toBeInTheDocument());

    es.emit({ kind: "assistant_delta", text: "Hel", at: "t" });
    await waitFor(() => expect(screen.getByText("Hel")).toBeInTheDocument());

    es.emit({ kind: "assistant_delta", text: "lo!", at: "t" });
    await waitFor(() => expect(screen.getByText("Hello!")).toBeInTheDocument());

    es.emit({ kind: "assistant_final", text: "Hello there!", at: "t" });
    await waitFor(() => expect(screen.getByText("Hello there!")).toBeInTheDocument());
    expect(screen.queryByText("Hello!")).not.toBeInTheDocument();
  });

  it("composer POSTs to /api/chat/send and clears the input on accept", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    const ChatPage = (await import("./page")).default;
    render(<ChatPage />);
    const input = await screen.findByLabelText(/message/i);
    fireEvent.change(input, { target: { value: "hi agent" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input).toHaveValue(""));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/chat/send"));
    expect(call).toBeTruthy();
    expect(JSON.parse((call as [string, RequestInit])[1].body as string)).toEqual({ text: "hi agent" });
  });

  it("shows the rejection reason and keeps the text when send is rejected", async () => {
    vi.stubGlobal("fetch", mockFetch({ send: { ok: false, reason: "channel disarmed" } }));
    const ChatPage = (await import("./page")).default;
    render(<ChatPage />);
    const input = await screen.findByLabelText(/message/i);
    fireEvent.change(input, { target: { value: "hi agent" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/channel disarmed/i)).toBeInTheDocument());
    expect(input).toHaveValue("hi agent");
  });

  it("shows the offline banner and disables the composer when the bridge is down", async () => {
    vi.stubGlobal("fetch", mockFetch({ status: STATUS_OFFLINE }));
    const ChatPage = (await import("./page")).default;
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByText(/assistant offline/i)).toBeInTheDocument());
    const input = screen.getByLabelText(/message/i);
    expect(input).toBeDisabled();
  });

  it("renders a pending approval card during a run and Deny POSTs to /api/approvals/respond", async () => {
    const pending = [
      {
        id: "appr-1",
        agentType: "claude",
        instanceId: "i1",
        tool: "fs.write",
        args: { path: "/tmp/x" },
        reason: "writes a file",
        estimatedCost: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:00.000Z",
        origin: "web",
      },
    ];
    const fetchMock = mockFetch({ status: STATUS_RUNNING, approvals: { ok: true, pending } });
    vi.stubGlobal("fetch", fetchMock);
    const ChatPage = (await import("./page")).default;
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByText("fs.write")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/approvals/respond"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call as [string, RequestInit])[1].body as string)).toEqual({ id: "appr-1", choice: "deny" });
    });
  });

  it("shows a 'requested from Telegram' badge for telegram-origin approvals", async () => {
    const pending = [
      {
        id: "appr-2",
        agentType: "claude",
        instanceId: "i1",
        tool: "fs.read",
        args: {},
        reason: "reads a file",
        estimatedCost: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:00.000Z",
        origin: "telegram",
      },
    ];
    vi.stubGlobal("fetch", mockFetch({ status: STATUS_RUNNING, approvals: { ok: true, pending } }));
    const ChatPage = (await import("./page")).default;
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByText("fs.read")).toBeInTheDocument());
    expect(screen.getByText(/requested from telegram/i)).toBeInTheDocument();
    // Dashboard is the designated approval surface — both buttons stay even for telegram-origin.
    expect(screen.getByRole("button", { name: /allow once/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });
});
