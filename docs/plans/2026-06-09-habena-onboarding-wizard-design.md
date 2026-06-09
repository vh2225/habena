# Habena Onboarding Wizard — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — ready for implementation plan
**Increment:** Workstream C, onboarding wizard. Follows the app-shell increment
(`2026-06-09-habena-dashboard-app-shell.md`).

## Goal

A first-run onboarding wizard in the local dashboard that guides a new user from
nothing to a working, guarded agent — by collecting their choices, showing the
exact CLI commands, and **live-detecting** each step's completion, ending on the
"trigger a call → watch it land" aha.

## Decision (resolved during brainstorming): mechanism = Guide + live-detect

The web package is **read-only** today (audit.db read + approvals IPC); core's CLI
owns all config-writing (`init`, `downstream add`, `agent add`, `install openclaw`)
via the `yaml` lib, with the config dir as the single source of truth. The wizard
therefore does **not** write config or spawn processes. It:
1. collects the user's choices (agent, downstream path, budget),
2. shows the exact copy-paste CLI command(s) derived from them,
3. **live-detects** completion by polling one new read-only status endpoint, auto-
   advancing with a ✓ as each artifact appears.

Rejected: "web runs the CLI" (new exec capability) and "web writes config" (duplicates
core's config logic → drift). Both noted as possible future follow-ons. This keeps the
CLI as the single source of truth, respects the read-only boundary, teaches the CLI,
and degrades gracefully for terminal-first users.

**Context:** today the dashboard runs via `pnpm dev` in `packages/web` (no `habena
dashboard` command yet), so the first-run audience is already at a terminal — copy-paste
commands are appropriate, and live-detection makes it feel interactive.

## Architecture

### New read-only endpoint — `GET /api/setup-status`
Returns the config-dir state the wizard reacts to:
```ts
{
  configExists: boolean;       // existsSync(config.yaml)
  downstreams: string[];       // keys of config.yaml `mcp_servers`
  agents: string[];            // keys of agents.yaml `agents`
  telegramConfigured: boolean; // config.yaml approval.channels.telegram present
  proxyRunning: boolean;       // approval socket exists (reuse proxyRunning())
  decisionCount: number;       // COUNT(*) from audit.db (0 if absent)
}
```
- Reads `config.yaml` / `agents.yaml` via a YAML parse — **adds a read-only `yaml`
  dep to the web package** (consistent with already reading `audit.db`).
- Reuses `config-dir.ts` for paths, `proxyRunning()` from `approval-ipc.ts`, and the
  audit reader for the count.
- Structured with an **injectable reader** (default reads real files) so the route +
  status logic are unit-testable without touching the filesystem.

### Wizard UI — `/welcome` (client page)
A visible, highlighted step list (single-pass wizard — best for novice/infrequent
setup) with progressive disclosure and safe defaults. Polls `/api/setup-status` every
~2s; each step shows its command(s) with a copy button and a live ✓ when detected.

**Steps (5):**
1. **Pick what you're guarding** — OpenClaw · Hermes · Claude Desktop · "guard tools
   manually." Sets the agent-name default and whether step 4 shows `habena install
   openclaw` (only OpenClaw has an installer today; others show "point your agent at
   Habena" guidance). Intro step, no detection.
2. **Initialize** — `habena init` (seeds the safe `cautious` preset + a default budget).
   Detect: `configExists`.
3. **Wire a downstream** — filesystem default, editable path (prefilled `~/workspace`):
   `habena downstream add filesystem <path>`. Detect: `downstreams.length > 0`.
4. **Register your agent** — name (from step 1) + daily budget (prefilled, e.g. 30):
   `habena agent add --name <name> --budget-daily <n>`; if OpenClaw, also show
   `habena install openclaw`. Detect: `agents.length > 0`.
5. **Start & prove it** — `habena start`, then "trigger a tool call and watch it land in
   **Decisions**." Detect: `proxyRunning`, then `decisionCount > 0` → "✓ It works — your
   agent is guarded," linking to `/decisions`. Optional **collapsed** sub-step: connect
   Telegram (shows the config snippet; skippable; detect `telegramConfigured`).

### Entry point
Overview (`/`) shows a **"Finish setup"** CTA when `!configExists`; `/welcome` is also
directly navigable. Once configured, the CTA disappears. No permanent nav clutter.

## Data flow & boundaries
Browser → new read-only `/api/setup-status` (+ existing routes) → config-dir files +
socket + audit.db. **No core/backend changes, no config writes, no process spawning.**
The first-run chicken-and-egg is fine — reacting to a not-yet-configured state is the
wizard's whole job.

## Error & empty states
- Status endpoint degrades gracefully: unreadable/missing files → the corresponding
  field is false/empty (never throws); a parse error on a malformed config → treat that
  field as "not yet" rather than erroring the whole response.
- Each step is non-blocking; the user can copy a command, run it elsewhere, and the ✓
  appears on the next poll. "You can change this later" reassurance; never block on the
  optional Telegram step.

## Testing
- jsdom+RTL for the wizard: current step advances when the polled status changes;
  shown commands reflect the user's inputs (path/budget/agent); copy buttons; the skip
  path for Telegram.
- Pure unit tests: the "current step given status" derivation, and the status reader
  (injectable — fed fake file contents, no real fs).
- `next build` + a short manual recipe cover the visual/integration layer.

## Out of scope (explicit follow-ons)
Actually running/writing setup from the web (the rejected options, if ever wanted);
Hermes / Claude-Desktop installers (need core support first); the Spend page (blocked on
cost attribution — tool calls currently carry $0).
