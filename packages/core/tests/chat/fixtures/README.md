# OpenClaw gateway frame fixtures

Verbatim WebSocket frames captured from a live OpenClaw gateway (protocol v4,
`ws://127.0.0.1:18789`) by `packages/core/scripts/probe-gateway.mjs`. These are
the ground truth for the FakeGateway test double and the OpenClawBridge
implementation. Secrets are scrubbed (`<REDACTED>`, `/cap/<REDACTED>`,
`/home/<user>`, `<lan-ip>`).

## Files

- `gateway-frames.json` — happy path: connect handshake, `chat.send`, and the
  full streamed reply through `state: "final"`.
- `gateway-frames-scope-fail.json` — negative case: a valid-but-non-backend
  client identity (`openclaw-probe`/`probe`) connects fine, but the gateway
  clears the requested scopes to `[]`, so `chat.send` fails with
  `{ code: "INVALID_REQUEST", message: "missing scope: operator.write" }`.

## Fixture shape

Both files are a flat chronological capture — `{ url, capturedAt, frames: [{ dir:
"in"|"out", at, frame }, ...] }` — **not** the nested
`{ connect: {request, response}, chatSend: ..., events: [...] }` shape sketched
in the plan prose. The flat shape is what the probe script actually produces and
is what later tasks should consume; it supersedes the plan's prose.

## Connect identity (the part the docs get wrong)

`connect.params.client.id` / `client.mode` are validated against closed enums;
the protocol doc's illustrative `"cli"`/`"operator"` values are rejected at
connect time. What works on loopback with the shared gateway token, **without a
`device` signature block**, is the documented same-process backend carve-out:

```json
"client": { "id": "gateway-client", "mode": "backend" }
```

Every other allowed identity (e.g. `"openclaw-probe"`/`"probe"`) passes connect
and gets an `ok: true` hello-ok — but with `hello-ok.auth.scopes: []` (scopes
silently cleared because there is no device identity), after which every scoped
RPC fails. That is the scope-fail fixture. Whether Habena's production bridge
should keep using the backend carve-out or implement real device pairing is an
open Task 5 decision.

## chat.send

- Params: `{ sessionKey, message, idempotencyKey }` — the field is `message`,
  **not** `text` (`text` is rejected: "unexpected property 'text'").
- The response is an immediate ack, not the reply:
  `{ type: "res", id, ok: true, payload: { runId, status: "started" } }`.
- The reply itself arrives as broadcast events, correlated by `runId`.

## Streamed reply events

Two parallel broadcast families carry the reply:

- `event: "chat"` — the high-level stream to mirror. Discriminated by
  `payload.state`: `"delta" | "final" | "error" | "aborted"` (delta/final/error
  are present in these captures; aborted is schema-confirmed). Delta payloads
  carry `deltaText` (the new chunk) plus `message` — the **cumulative**
  assistant snapshot `{ role: "assistant", content: [{ type: "text", text }],
  timestamp }`. Final carries `stopReason` + the full `message`. Error carries
  `errorMessage`. Common envelope: `runId, sessionKey, agentId?, seq`.
- `event: "agent"` — lower-level. `stream: "lifecycle"` frames carry
  `data.phase` (`start`/`finishing`/`end`/`error`); `stream: "assistant"` frames
  carry `data: { text, delta }` (cumulative + chunk — note the different field
  names vs `chat`'s `deltaText`).

**Filter by `runId`.** The socket is a broadcast bus: unrelated background runs
(e.g. `active-memory-*` jobs) and ambient `health` / `tick` / `presence` events
interleave with the reply — both captures contain real examples. Match events to
the `runId` returned by the `chat.send` ack; ignore everything else.
