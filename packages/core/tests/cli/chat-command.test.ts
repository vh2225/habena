import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { encode, decodeLines } from "../../src/ipc/protocol.js";

// Full-CLI tests for `habena chat status|rearm`, same harness as
// tests/cli/commands.test.ts (fresh HOME per test), but talking to a stub
// IPC server on a real unix socket instead of a real proxy so we can hand
// it canned chat_status_result / chat_ack / error frames and observe
// exactly what the CLI sent and printed.
//
// Cases where the stub server must respond to the CLI subprocess use the
// ASYNC `spawn` (like tests/e2e/approvals-forward.test.ts), never
// `spawnSync` — spawnSync blocks this process's event loop for the whole
// child lifetime, which would starve the in-process stub server of the
// I/O events it needs to accept the connection and answer frames.
// Cases with no stub server (proxy-not-running / invalid-channel) use the
// simpler synchronous `run()`.

const CLI = join(process.cwd(), "dist", "cli", "index.js");

let home: string;
let socketPath: string;

function run(args: string[]) {
  return spawnSync("node", [CLI, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
    timeout: 15_000,
  });
}

/** Async CLI invocation: waits for the child to exit, then resolves with its output. */
function runAsync(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [CLI, ...args], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out waiting for CLI to exit (args: ${args.join(" ")})`));
    }, 15_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Minimal stub proxy: sends `hello` on connect, answers frames via `onFrame`. */
async function startStub(
  path: string,
  onFrame: (msg: any, socket: Socket) => void
): Promise<{ received: unknown[]; stop: () => Promise<void> }> {
  const received: unknown[] = [];
  const server: Server = createServer((socket) => {
    socket.write(encode({ type: "hello", version: "test" }));
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const { messages, remainder } = decodeLines(buffer);
      buffer = remainder;
      for (const msg of messages) {
        received.push(msg);
        onFrame(msg, socket);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return {
    received,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

beforeEach(() => {
  home = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "habena-chat-cli-"));
  mkdirSync(join(home, ".habena"), { recursive: true });
  socketPath = join(home, ".habena", "agentguard.sock");
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("chat status", () => {
  it("prints bridge state, a DISARMED marker, and queue depth", async () => {
    const stub = await startStub(socketPath, (msg, socket) => {
      if (msg.type === "chat_status") {
        socket.write(
          encode({
            type: "chat_status_result",
            bridgeUp: true,
            running: true,
            disarmed: ["telegram"],
            queueDepth: 3,
          })
        );
      }
    });

    const result = await runAsync(["chat", "status"]);
    await stub.stop();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("bridge: up");
    expect(result.stdout).toContain("telegram: DISARMED");
    expect(result.stdout).toContain("queue depth: 3");
  });

  it("shows a channel as armed when it isn't in the disarmed list", async () => {
    const stub = await startStub(socketPath, (msg, socket) => {
      if (msg.type === "chat_status") {
        socket.write(
          encode({
            type: "chat_status_result",
            bridgeUp: false,
            running: false,
            disarmed: [],
            queueDepth: 0,
          })
        );
      }
    });

    const result = await runAsync(["chat", "status"]);
    await stub.stop();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("bridge: down");
    expect(result.stdout).not.toContain("DISARMED");
    expect(result.stdout).toContain("web: armed");
    expect(result.stdout).toContain("telegram: armed");
  });

  it("renders DISARMED on every disarmed channel when all are tripped", async () => {
    // Guards the per-channel branching: if rendering keyed off only the
    // first element of `disarmed` (or collapsed it into one boolean),
    // one of the two DISARMED assertions below would fail.
    const stub = await startStub(socketPath, (msg, socket) => {
      if (msg.type === "chat_status") {
        socket.write(
          encode({
            type: "chat_status_result",
            bridgeUp: true,
            running: false,
            disarmed: ["web", "telegram"],
            queueDepth: 1,
          })
        );
      }
    });

    const result = await runAsync(["chat", "status"]);
    await stub.stop();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("web: DISARMED");
    expect(result.stdout).toContain("telegram: DISARMED");
    expect(result.stdout).not.toContain(": armed"); // no channel may still read as armed
  });

  it("fails with a clear message when the proxy isn't running", () => {
    // No stub server started and no socket file present.
    const result = run(["chat", "status"]);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("habena start");
  });

  it("surfaces a disabled-chat server error clearly", async () => {
    const stub = await startStub(socketPath, (_msg, socket) => {
      socket.write(encode({ type: "error", message: "chat disabled" }));
    });

    const result = await runAsync(["chat", "status"]);
    await stub.stop();

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("chat disabled");
  });
});

describe("chat rearm", () => {
  it("sends chat_rearm with the given channel and prints a confirmation", async () => {
    const stub = await startStub(socketPath, (msg, socket) => {
      if (msg.type === "chat_rearm") {
        socket.write(encode({ type: "chat_ack", ok: true }));
      }
    });

    const result = await runAsync(["chat", "rearm", "telegram"]);
    await stub.stop();

    expect(result.status).toBe(0);
    expect(stub.received).toContainEqual({ type: "chat_rearm", channel: "telegram" });
    expect(result.stdout.toLowerCase()).toContain("re-armed telegram");
  });

  it("fails with a clear message when the proxy isn't running", () => {
    const result = run(["chat", "rearm", "telegram"]);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("habena start");
  });

  it("surfaces a disabled-chat server error clearly", async () => {
    const stub = await startStub(socketPath, (_msg, socket) => {
      socket.write(encode({ type: "error", message: "chat disabled" }));
    });

    const result = await runAsync(["chat", "rearm", "web"]);
    await stub.stop();

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("chat disabled");
  });

  it("rejects an invalid channel without ever connecting to the socket", () => {
    // No stub server running and no socket file present: if the command
    // tried to connect first it would surface the "habena start" message
    // instead of the validation error.
    const result = run(["chat", "rearm", "slack"]);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("Invalid channel");
    expect(result.stdout + result.stderr).not.toContain("habena start");
  });
});
