import { createConnection } from "node:net";
import type { Duplex } from "node:stream";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  encode,
  decodeLines,
  type ServerMessage,
  type ClientMessage,
  type ApprovalChoice,
  type SerializedPendingApproval,
} from "./approval-protocol";

const SOCKET_FILE = "agentguard.sock";

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}
function configDir(): string {
  const override = process.env.HABENA_CONFIG_DIR ?? process.env.AGENTGUARD_CONFIG_DIR;
  if (override && override.trim() !== "") return expandHome(override.trim());
  const habena = join(homedir(), ".habena");
  if (existsSync(habena)) return habena;
  const legacy = join(homedir(), ".agentguard");
  if (existsSync(legacy)) return legacy;
  return habena;
}
export function socketPath(): string {
  return join(configDir(), SOCKET_FILE);
}
export function proxyRunning(): boolean {
  return existsSync(socketPath());
}

/** Injectable connector — default opens the real unix socket; tests pass a fake Duplex. */
export interface IpcOptions {
  connect?: () => Duplex;
  timeoutMs?: number;
}
function defaultConnect(): Duplex {
  return createConnection(socketPath()) as unknown as Duplex;
}

/** Generic one-shot: send a request, resolve when `match` returns a value, then close. */
function roundTrip<T>(
  request: ClientMessage,
  match: (msg: ServerMessage) => T | undefined,
  opts: IpcOptions
): Promise<T> {
  const conn = (opts.connect ?? defaultConnect)();
  const timeoutMs = opts.timeoutMs ?? 2000;
  return new Promise<T>((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      clearTimeout(timer);
      conn.removeAllListeners("data");
      conn.removeAllListeners("error");
      try { (conn as any).end?.(); } catch { /* noop */ }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for proxy response"));
    }, timeoutMs);
    conn.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const { messages, remainder } = decodeLines(buffer);
      buffer = remainder;
      for (const raw of messages) {
        const hit = match(raw as ServerMessage);
        if (hit !== undefined) { cleanup(); resolve(hit); return; }
      }
    });
    conn.on("error", (err: Error) => { cleanup(); reject(err); });
    conn.write(encode(request));
  });
}

export async function listPending(opts: IpcOptions = {}): Promise<SerializedPendingApproval[]> {
  return roundTrip(
    { type: "list_pending" },
    (msg) => (msg.type === "pending_list" ? msg.pending : undefined),
    opts
  );
}

export async function respond(
  id: string,
  choice: ApprovalChoice,
  opts: IpcOptions = {}
): Promise<{ ok: boolean; reason?: string }> {
  return roundTrip(
    { type: "respond", id, choice },
    (msg) =>
      msg.type === "respond_ack" && msg.id === id
        ? { ok: msg.ok, reason: msg.reason }
        : undefined,
    opts
  );
}
