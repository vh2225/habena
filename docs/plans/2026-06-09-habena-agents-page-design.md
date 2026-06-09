# Habena Agents Page — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — ready for implementation plan
**Increment:** Workstream C, Agents drilldown. Follows the onboarding wizard
(`2026-06-09-habena-onboarding-wizard.md`).

## Goal

A read-only `/agents` page that lists each agent — merging the registry
(`agents.yaml`) with observed activity (`audit.db`) — so the user can see who's
registered, how they're behaving, and which agents are active but unregistered.

## Why this (and not Spend / threat-alerts / a policy editor)

The data exists. Per-agent activity is real in `audit.db` (grouped by
`agent_type`), and the registry is in `agents.yaml`. By contrast: Spend is
blocked (tool calls cost $0 — see the cost-attribution gap), threat-alerts have
no data until Workstream B's detection ships, and a policy *editor* would breach
the dashboard's read-only boundary. Agents fills the nav's existing "Agents
(soon)" slot and matches the "manage your bots end-to-end" goal.

## Data surface (confirmed)

- **Registry** (`agents.yaml`, per agent): `name`, `mode`
  (enforced|learning|advisory), `registered` (ISO date), `fingerprint`,
  `permissions.budget.daily`.
- **Activity** (`audit.db`, grouped by `agent_type`): decision counts by outcome
  (allow/deny/require_approval), top tools, distinct `instance_id` count
  ("instances seen" — historical, since core's live instance map isn't
  persisted), and max(timestamp) ("last seen").
- **Merge:** registered ∪ observed. *registered* (in agents.yaml) · *idle*
  (registered, no audit rows) · ***observed but unregistered*** (in audit, not in
  registry — a useful safety signal).

## Architecture (read-only, no core changes)

### New read-only endpoint — `GET /api/agents`
Returns an array of agent summaries, composing two server-only reads:
1. **Registry** — a server-only `lib/agents-registry.server.ts` that parses
   `agents.yaml` (via `yaml`, like `setup-status.server.ts`) → `{ name, mode,
   registered, fingerprint, budgetDaily }[]`. Server-only (must not enter the
   client bundle).
2. **Activity** — new aggregate queries added to `lib/audit.ts` (already
   server-only / better-sqlite3): per `agent_type` → decision-outcome counts, top
   tools (top ~5), distinct instance count, last-seen timestamp.

The route merges them by name/agent_type into:
```ts
interface AgentSummary {
  name: string;
  status: "registered" | "idle" | "observed";  // observed = unregistered
  mode: string | null;                          // null if unregistered
  registered: string | null;
  fingerprint: string | null;
  budgetDaily: number | null;
  decisions: { total: number; allow: number; deny: number; approval: number };
  topTools: { tool: string; count: number }[];
  instancesSeen: number;
  lastSeen: string | null;
}
```
Degrades gracefully (missing/unreadable agents.yaml → registry empty; no audit db
→ activity zeros), wrapped so the route never throws.

### `/agents` client page
Polls `GET /api/agents` (~5s); renders one card per agent:
- name + `mode` badge + a status chip (registered / idle / **observed-unregistered**
  highlighted as a warn).
- decision mix using the existing color+glyph Badge convention (allow/deny/approval).
- top tools, instances-seen, last-seen.
- "Daily budget: $N" as plain config text (NOT a consumed gauge — spend is $0;
  stay honest about the cost gap). Omit when unset.
- "View decisions →" → `/decisions?agent=<name>`.
- Teaching empty state when no agents.

### Wiring
- Flip the nav's **Agents** item from `soon` → a live link to `/agents`.
- `/decisions` reads an `?agent=` query param to seed its agent filter, so the
  per-agent drilldown link actually pre-filters. (Uses `useSearchParams`.)

## Client/server boundary (lesson from the wizard increment)
`lib/audit.ts` (better-sqlite3) and the registry reader are server-only and must
be reachable ONLY from the route, never from a `"use client"` import graph. The
`/agents` page imports only the `AgentSummary` type (via `import type`) and pure
helpers — never the readers. `next build` is run in the sweep to confirm the
boundary holds.

## Error & empty states
- Route wraps all reads in try/catch → returns `[]` (or zeroed activity) rather
  than erroring the poller.
- Page: friendly empty state ("No agents yet — register one with `habena agent
  add`…"); a proxy-down / no-data case simply shows the empty state.

## Testing
- Pure merge/classification logic (registry ∪ activity → status + summary) →
  unit-tested (node env) with fake inputs.
- `/api/agents` route → tested with the readers mocked.
- `/agents` page → jsdom+RTL (cards render; status classification incl.
  observed-unregistered; decision mix; budget shown as config not gauge; empty
  state).
- `/decisions` `?agent=` seeding → an RTL test (mock `useSearchParams`).
- The raw better-sqlite3 aggregate queries are covered by `next build` + the
  manual recipe (consistent with the existing untested audit reader).

## Out of scope (explicit follow-ons)
A per-agent detail route `/agents/[name]`; live instance tracking (core doesn't
persist it); real spend / consumed budget (blocked on cost attribution); editing
agent config (write boundary); Hermes/Claude-Desktop specifics.
