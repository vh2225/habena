// packages/core/scripts/probe-gateway.mjs
// One-shot investigator: connects to the local OpenClaw gateway, performs the
// connect handshake, sends one chat message, records every frame in/out for
// 30s, writes tests/chat/fixtures/gateway-frames.json (secrets redacted).
// Usage: OPENCLAW_GATEWAY_TOKEN=... node scripts/probe-gateway.mjs [ws://127.0.0.1:18789]
//
// Set PROBE_IDENTITY=probe to connect with a valid-but-non-backend client
// identity (openclaw-probe/probe). That variant passes connect but the
// gateway clears the requested scopes to [], so chat.send fails with
// "missing scope: operator.write" -- the negative case is written to
// tests/chat/fixtures/gateway-frames-scope-fail.json instead.
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
//     (e.g. "openclaw-probe"/"probe" -- see PROBE_IDENTITY above) *do* pass
//     connect and get `ok:true` hello-ok, but the gateway silently clears
//     requested scopes to `[]`, which then fails every scoped RPC ("missing
//     scope: operator.write" on chat.send) -- functionally the same
//     device-signature-block requirement Step 4 asks us to capture if hit,
//     just surfaced as a post-connect scope error instead of a connect-time
//     rejection. That negative case is captured in
//     gateway-frames-scope-fail.json.
//   - chat.send params use `message`, not `text` (`text` isn't in
//     ChatSendParamsSchema at all -- confirmed against
//     packages/gateway-protocol/src/schema/logs-chat.d.ts in the openclaw
//     package).
import { WebSocket } from "ws";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.argv[2] ?? "ws://127.0.0.1:18789";
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
const scopeFailVariant = process.env.PROBE_IDENTITY === "probe";
const outName = scopeFailVariant ? "gateway-frames-scope-fail.json" : "gateway-frames.json";
const frames = [];
const record = (dir, frame) => frames.push({ dir, at: new Date().toISOString(), frame });

// Pattern-based scrubbing, not just the known token literal:
//  - the shared gateway token itself, wherever it appears
//  - any capability-URL bearer segment (/cap/<random> grants access by itself)
//  - the value of any JSON field literally named token/accessToken/secret
//  - the operator's home-dir username and LAN IPs (fixture hygiene, not secrets)
const redact = (s) => {
  let out = token ? s.replaceAll(token, "<REDACTED>") : s;
  out = out.replace(/\/cap\/[A-Za-z0-9_-]+/g, "/cap/<REDACTED>");
  out = out.replace(/"(token|accessToken|secret)"\s*:\s*"(?:[^"\\]|\\.)*"/g, '"$1": "<REDACTED>"');
  out = out.replace(/\/home\/[A-Za-z0-9._-]+/g, "/home/<user>");
  out = out.replace(/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, "<lan-ip>");
  return out;
};
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
        client: scopeFailVariant
          ? { id: "openclaw-probe", version: "0.0.1", platform: "linux", mode: "probe" }
          : { id: "gateway-client", version: "0.0.1", platform: "linux", mode: "backend" },
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
  writeFileSync(new URL(`../tests/chat/fixtures/${outName}`, import.meta.url),
    JSON.stringify({ url, capturedAt: new Date().toISOString(), frames }, null, 2));
  console.log(`wrote ${frames.length} frames to ${outName}`);
  ws.close(); process.exit(0);
}, 30_000);
