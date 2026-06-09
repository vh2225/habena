# Habena Policy Viewer — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — ready for implementation plan
**Increment:** Workstream C, Policy viewer. Follows the Agents page
(`2026-06-09-habena-agents-page.md`).

## Goal

A read-only `/policy` page that faithfully renders the policy **configuration**
from `config.yaml` — budget, rules (in first-match-wins order), inherited rule
packs, approval config, and downstreams — so the user can see what guardrails are
in force without reading YAML.

## Why a viewer (not an editor)

The dashboard is read-only by design; an editor would mutate `config.yaml` and
breach that boundary (and duplicate core's config logic). A viewer is honest,
useful, and data-backed: `config.yaml` (written by `habena init` with the
`cautious` preset's rules inline) already contains everything to show.

## Data surface (confirmed)

`config.yaml` (shape from `packages/core/src/policy/types.ts`):
- `budget?`: `{ daily, monthly, per_session, per_request, alert_at, on_exceed }`.
- `rules?: Rule[]` — written **inline** by init. `Rule` = `{ match: { tool?,
  server?, args_contain?, command_matches? }, action: "allow"|"deny"|
  "require_approval"|"deny_unless"|"deny_if", enforcement?: "advisory"|
  "soft_mandatory"|"hard_mandatory", reason? }`. **Order is semantic**
  (first-match-wins).
- `extends?: string[]` — rule-pack names (packs are separate YAML shipped in the
  *core* package; resolved at runtime — NOT expanded here).
- `approval?`: `{ timeout_action?, always_require?(tools/tags), channels? }`.
- `mcp_servers?: Record<name, { command, args?, ... }>`.

## Honesty framing (the recurring discipline)

The page is labeled **"your policy configuration"** — it shows what's in
`config.yaml`. It does NOT claim to be the fully-resolved *effective* policy,
which also folds in `extends` pack rules, any hard-coded built-in boundaries (in
core code, not YAML), and the 3-tier / session-override resolution. We show what
we can read, labeled as config, and note that `extends` packs add rules resolved
at runtime.

## Architecture (read-only, no core changes)

- **`lib/policy.ts`** — CLIENT-SAFE (import-free): the `PolicyView` types
  (`PolicyView`, `RuleView`, `BudgetView`, `ApprovalView`, `DownstreamView`) +
  a pure `actionKind(action) → "allow"|"deny"|"warn"|"neutral"` helper
  (allow→allow; deny/deny_if/deny_unless→deny; require_approval→warn; else
  neutral).
- **`lib/policy.server.ts`** — SERVER-ONLY: pure `parsePolicy(text) → PolicyView`
  (uses `yaml`; never throws; unit-tested with fake config text) + `readPolicy()`
  IO (reads `config.yaml` from `configDir()`). Mirrors the
  `setup-status.server.ts` / `agents-registry.server.ts` split.
- **`GET /api/policy`** route → `readPolicy()`, degrades to an empty view
  (`{ configured: false, ... }`) on any error so the page never crashes.
- **`/policy`** client page — renders the `PolicyView`: budget section, rules
  list (index + match + action badge + enforcement badge + reason), extends
  packs, approval, downstreams; teaching empty state when no config. Imports ONLY
  `type PolicyView` + `actionKind` from `@/lib/policy` (client-safe) +
  `Card`/`Badge`. NEVER the server reader.
- Flip the nav's **Policy** item from `soon` → a live link to `/policy`.

## Client/server boundary (lesson carried forward)

`lib/policy.server.ts` (yaml + node:fs) is imported ONLY by the route. The page
imports only the pure `lib/policy.ts` (import-free) + UI primitives. `next build`
in the sweep confirms no `node:*` leaks into the client bundle.

## PolicyView shape (route response)
```ts
interface RuleView { index: number; match: Record<string, unknown>; action: string; enforcement: string | null; reason: string | null; }
interface BudgetView { daily: number | null; monthly: number | null; perSession: number | null; perRequest: number | null; onExceed: string | null; alertAt: number[] | null; }
interface ApprovalView { timeoutAction: string | null; alwaysRequire: string[]; channels: string[]; }   // channel NAMES only — never tokens
interface DownstreamView { name: string; command: string | null; }
interface PolicyView {
  configured: boolean;          // config.yaml present + parsed
  budget: BudgetView | null;
  rules: RuleView[];
  extendsPacks: string[];
  approval: ApprovalView | null;
  downstreams: DownstreamView[];
}
```

## Error & empty states
- `parsePolicy(null|malformed)` → `{ configured: false, budget: null, rules: [],
  extendsPacks: [], approval: null, downstreams: [] }` (never throws); route
  catch returns the same.
- Page: when `!configured`, a teaching empty state ("No policy yet — run `habena
  init` or finish setup in the wizard").
- Approval `channels` lists only the channel *names* present (e.g. `["telegram"]`)
  — never any token/secret value.

## Testing
- `parsePolicy` (node env, fake config text): extracts budget, rules in order
  with action/enforcement/reason, extends, approval (channel names only),
  downstreams; never throws on malformed/empty/null. `actionKind` mapping.
- `GET /api/policy` route — reader mocked.
- `/policy` page — jsdom+RTL: renders budget, a rule row (match + action badge +
  enforcement badge), extends packs, empty state.
- `next build` confirms the client/server bundle boundary.

## Out of scope (explicit follow-ons)
Editing policy (write boundary); resolving/expanding `extends` rule-packs from the
core package (fragile cross-package read + still not the true effective policy);
showing hard-coded built-in boundaries (live in core code); a policy *simulator*
("what would happen for tool X").
