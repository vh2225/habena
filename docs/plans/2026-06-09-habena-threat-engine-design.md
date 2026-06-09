# Habena Threat-Detection Engine — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — ready for implementation plan
**Increment:** Workstream B, increment 1. First core/backend increment (prior work
was the read-only web dashboard, Workstream C).

## Goal

A **local, no-cloud heuristic threat-detection engine** in `packages/core` that
catches the three threats Habena's README advertises — tool-poisoning, rug-pull
(tool-definition drift), and credential-egress — by analyzing the tool definitions
and call args Habena already sees, and folding verdicts into the existing
policy/approval/audit path.

## Why this shape (not the original cloud feed)

The scaffolded `threat/` module is inert: `ThreatFeedManager.sync()`/`loadLocal()`/
`getEntries()` are TODO stubs that fetch from a **Habena cloud API that does not
exist**, and `ThreatChecker` is never wired into the proxy. Building the cloud
service is out of scope (solo, GitHub-first, no backend). The honest, higher-value
reframe is **local heuristic detection** on data Habena already has:
`AggregatedTool` carries each tool's `name`/`description`/`inputSchema` (from
`listTools()`), and `handleToolCall` sees every call's args. This works offline and
has no cloud dependency.

## Architecture

A `ThreatEngine` with three PURE detectors + a snapshot store, wired at two seams.
Verdicts are first-class `PolicyDecision`s (the existing stubbed
`ThreatChecker.toDecision` already returns one), combined with the policy decision
via the existing `stricter()` helper (hard boundaries still win).

### Detectors (pure functions — the core value + false-positive control)
1. **Tool-poisoning** — `detectToolPoisoning(description) → Finding[]`: instruction-
   injection / hidden-instruction / exfil cues in a tool's *description* (e.g.
   "ignore previous instructions", "do not tell the user/mention this", references
   to `~/.ssh`, `.env`, `id_rsa`, "send/forward … to <addr/url>", suspicious
   base64/zero-width-unicode markers). Severity by signal strength.
2. **Credential-egress** — `detectCredentialEgress(args) → Finding[]`: secrets in
   *call args* — PEM private-key blocks, AWS keys (`AKIA`/`ASIA…`), GitHub
   (`ghp_…`)/Slack (`xox…`) tokens, `id_rsa` content, common secret-env shapes,
   high-entropy token-like strings.
3. **Rug-pull / drift** — `detectDrift(toolDef, snapshot) → Finding|null`:
   `hash(description + JSON(inputSchema))` vs the stored snapshot — **new** tool →
   record (no finding); **changed** → drift finding.

A `Finding` = `{ detector, severity: "low"|"medium"|"high"|"critical", message, evidence? }`
(evidence is truncated + must NOT echo full secrets).

### Two wiring seams
- **List time** (`DownstreamManager` tool refresh): for each `AggregatedTool`, run
  tool-poisoning + drift → update the snapshot store, audit findings, and remember
  per-(server,tool) flags in the engine.
- **Call time** (`ProxyDispatcher.handleToolCall`, right after `policy.evaluate`):
  run credential-egress on args + fold in any list-time flag for `(server,tool)` →
  build a threat `PolicyDecision` and combine via `stricter()`. (The existing
  optional local feed check can run here too.)

### Verdict → decision mapping
Per matched detector, the configured enforcement level decides the action:
`block → deny (hard_mandatory)`, `require_approval → require_approval
(soft_mandatory)`, `warn → allow but audited with the finding`, `off → skip`.
The worst finding wins; `risk_level` set from severity; `tier: "built_in"`;
`reason: "threat:<detector>: <message>"`.

## Config (`config.yaml` → `AgentGuardConfig.threat?`)
```yaml
threat:
  tool_poisoning: require_approval   # off | warn | require_approval | block
  credential_egress: require_approval
  rug_pull: require_approval
  # optional: local signature file (no cloud sync)
  feed_file: ~/.habena/threat-feed.json
```
**Default = `require_approval` for all three** — a deliberate choice: heuristics have
false positives, so the safe default is *ask the human* (Habena's human-in-the-loop
ethos), not silently hard-block. `block` is available for users who want it. Missing
`threat:` section → defaults applied.

## Persistence
`tool-snapshots.json` in the config dir: `{ "<server>/<tool>": { hash, firstSeen,
lastSeen } }`. Drift's only state. Read/written by a small `ToolSnapshotStore`
(injectable path for tests). Corrupt/missing file → treated as empty (never throws).

## Honesty (recurring discipline)
- The **cloud feed is dropped** — the `ThreatFeedManager` cloud-sync TODOs are
  removed; an *optional local* `threat-feed.json` may feed the engine but is not
  required and not synced.
- Detectors are **best-effort heuristics** with false positives/negatives. The
  `require_approval` default (human reviews) and clear `reason` tags exist precisely
  to manage that. Evidence in findings is truncated and must never echo a full
  secret value (audit-log hygiene).

## Surfacing
Threat decisions land in the **existing audit log** with `threat:<detector>` reason
tags + the decision (deny/require_approval) → immediately visible and filterable in
the **Decisions** dashboard stream. A dedicated **threat-alerts UI** (severity/scope/
remediation cards, ack/snooze) is a separate follow-on once events accrue.

## Error handling
- Every detector + the engine is non-throwing; a detector error degrades to "no
  finding" (fail-open on detection error, never crash a tool call).
- A malformed snapshot file or feed file → treated as empty.
- Threat checks must add negligible latency (string/regex scans over bounded input).

## Testing
- **Detectors:** thorough positive AND negative unit suites (the real value — catch
  the attack, don't cry wolf on benign tools/args). Include the README's canonical
  cases (poisoned description exfiltrating `~/.ssh/id_rsa`; an arg carrying a PEM key).
- **Snapshot store:** new/unchanged/changed/corrupt-file cases.
- **Engine:** verdict→decision mapping per enforcement level; worst-finding-wins;
  fold-in of list-time flags at call time.
- **Wiring:** `handleToolCall` escalates on a planted egress arg; list-time scan
  records snapshots + audits a poisoned description. (Note `tests/ipc/**` +
  `tests/e2e/**` fail sandbox-only — exclude when running locally.)

## Out of scope (explicit follow-ons)
The threat-alerts dashboard UI; any cloud feed/sync; ML/embedding-based detection;
auto-quarantine of servers; per-agent threat policy; a threat-events DB table
(the audit log suffices for now). Editing config stays CLI-side.
