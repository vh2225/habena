// packages/core/scripts/probe-gateway.mjs
// One-shot investigator: connects to the local OpenClaw gateway, performs the
// connect handshake, sends one chat message, records every frame in/out for
// 30s, writes tests/chat/fixtures/gateway-frames.json (secrets redacted).
// Usage: OPENCLAW_GATEWAY_TOKEN=... node scripts/probe-gateway.mjs [ws://127.0.0.1:18789]
//
// Adjustments forced by the live gateway (protocol.md's examples didn't match
// the running v4 gateway's actual TypeBox schema enums/params):
//   - client.id/client.mode are validated against closed enums. The doc's
//     illustrative "cli"/"operator" values are rejected outright
//     (`must be equal to one of the allowed values`). "gateway-client"/
//     "backend" is the one enum pair matching the doc's own "Trusted
//     same-process backend clients ... may omit device on direct loopback
//     connections" carve-out, so it's what this probe uses to exercise the
//     no-device-identity path end to end. Non-"gateway-client" client ids
//     (e.g. "openclaw-probe"/"probe", tried first) *do* pass connect and get
//     `ok:true` hello-ok, but the gateway silently clears requested scopes to
//     `[]`, which then fails every scoped RPC ("missing scope:
//     operator.write" on chat.send) -- functionally the same
//     device-signature-block requirement Step 4 asks us to capture if hit,
//     just surfaced as a post-connect scope error instead of a connect-time
//     rejection. That earlier no-scopes run is not re-derivable from this
//     script's single code path, so it's summarized in the task report
//     instead of re-captured in the fixture.
//   - chat.send params use `message`, not `text` (`text` isn't in
//     ChatSendParamsSchema at all -- confirmed against
//     packages/gateway-protocol/src/schema/logs-chat.d.ts in the openclaw
//     package).
import { WebSocket } from "ws";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.argv[2] ?? "ws://127.0.0.1:18789";
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
const frames = [];
const record = (dir, frame) => frames.push({ dir, at: new Date().toISOString(), frame });

const redact = (s) => token ? s.replaceAll(token, "<REDACTED>") : s;
const ws = new WebSocket(url);
const send = (obj) => { const s = JSON.stringify(obj); record("out", JSON.parse(redact(s))); ws.send(s); };

ws.on("message", (data) => {
  const frame = JSON.parse(redact(data.toString()));
  record("in", frame);
  // Reply to the pre-connect challenge with a connect request.
  if (frame.type === "event" && frame.event === "connect.challenge") {
    send({
      type: "req", id: randomUUID(), method: "connect",
      params: {
        minProtocol: 3, maxProtocol: 4,
        client: { id: "gateway-client", version: "0.0.1", platform: "linux", mode: "backend" },
        role: "operator", scopes: ["operator.read", "operator.write"],
        caps: [], commands: [], permissions: {},
        auth: token ? { token } : undefined,
        locale: "en-US", userAgent: "habena-probe/0.0.1",
      },
    });
  }
  // After hello-ok, send one chat message and just record whatever comes back.
  if (frame.type === "res" && frame.ok && frame.payload?.type === "hello-ok") {
    send({ type: "req", id: randomUUID(), method: "chat.send",
           params: { sessionKey: "habena-probe", message: "Reply with exactly: PROBE_OK", idempotencyKey: randomUUID() } });
  }
});
ws.on("error", (err) => record("in", { probeError: String(err?.message ?? err) }));
setTimeout(() => {
  writeFileSync(new URL("../tests/chat/fixtures/gateway-frames.json", import.meta.url),
    JSON.stringify({ url, capturedAt: new Date().toISOString(), frames }, null, 2));
  console.log(`wrote ${frames.length} frames`);
  ws.close(); process.exit(0);
}, 30_000);
