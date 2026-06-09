# Habena Dashboard App-Shell — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — ready for implementation plan
**Increment:** Workstream C, app-shell. Follows the approvals-queue web UI
(`2026-06-09-habena-workstream-c-approvals-web.md`).

## Goal

Give the local dashboard (`packages/web`, Next.js 16 / React 19 / Tailwind v4) a
coherent home: a persistent left nav + top status bar wrapping every page, and
fold the existing read-only decision stream into that frame with a meaningful
upgrade (filters + a policy-"why" drill-down).

## Decisions (resolved during brainstorming)

- **Component stack: Hybrid (libs, not the shadcn CLI).** Reuse the hand-rolled
  `Badge`/`Button`/`Card` primitives. Add only the two libraries that pay off
  now: **`@tanstack/react-table`** (sort/filter engine for the decision table)
  and **`cmdk`** (⌘K command palette). No `components.json`, no shadcn init —
  avoids Next16/React19/Tailwind-v4 toolchain risk and doesn't re-skin shipped
  primitives. shadcn remains adoptable later if a screen needs Radix's heavy
  components (Dialog/Combobox).
- **Decision-stream depth: B — migrate + drill-down.** Restyle + filters +
  row→drawer policy trace + density toggle. *Defer* live-tail sampling and the
  patterns/group-similar view (low payoff at single-assistant volume).
- **Add jsdom + React Testing Library** to close the component-test gap the
  prior increment's review flagged.

## Architecture

### Routing & shell
A shared shell (rendered in the root layout or a layout wrapper) gives every
page a left nav + top status bar.

| Route | Page | Notes |
|-------|------|-------|
| `/` | **Overview** *(new)* | Summary stat cards (`/api/summary`: total/allowed/denied/pending) + a compact recent-activity peek. Friendly landing. |
| `/decisions` | **Decisions** | The current `/` stream **moves here** and gets the B upgrade. |
| `/approvals` | **Approvals** | Unchanged; now inside the shell. |
| Agents · Spend · Policy | — | Shown in nav, **disabled with a "soon" tag**. No dead links; roadmap visible. |

The old `/` decision-stream page is repurposed: its table logic moves to
`/decisions`, and `/` becomes the Overview.

### Left nav
Links: Overview · Decisions · Approvals · (Agents · Spend · Policy — disabled
"soon"). Active-route highlight. Uses `next/link` + `usePathname`.

### Top status bar (scoped to sourceable data only)
- **Proxy health** — reachable / not, derived from whether the APIs return `ok`.
- **Pending approvals count** — from `/api/approvals`; links to `/approvals`.
- **Spend vs. budget is intentionally deferred** — no spend endpoint exists yet;
  it lands with the Spend increment rather than showing a fake gauge.

### Decisions stream (B upgrade)
- `@tanstack/react-table` drives the table: sortable columns; **client-side
  filters** (agent / decision / server) over the already-fetched rows — **no
  backend change** (we already fetch ≤100 rows; in-memory filtering is plenty at
  this volume).
- **Density toggle** (compact ↔ expanded).
- **Row → drawer drill-down**: clicking a row opens a side panel showing the
  policy **"why"** — `tier`, `ruleMatched`, `reason`, `latencyMs`, timestamps,
  `resultStatus` (all fields the audit log already stores; surfaced via the rows
  already fetched — no new endpoint). Hand-rolled panel: backdrop, Escape-to-
  close, focus trap, `role="dialog"` + `aria-modal`.
- Retains the existing 2 s poll + pause toggle.

### ⌘K command palette (`cmdk`)
Minimal: ⌘K opens a searchable list to jump between pages (Overview / Decisions
/ Approvals). The signature premium touch and **lowest-priority slice** — if
`cmdk` fights the toolchain it is cut without blocking the shell.

## Data flow

Browser → existing Next route handlers (`/api/summary`, `/api/decisions`,
`/api/approvals`) → SQLite audit reader / proxy IPC. **No backend/API changes
in this increment** — all new behavior (filtering, drill-down, nav, palette) is
client-side over data already served. Status-bar health/pending reuse the
approvals + summary endpoints.

## Error & empty states
- Proxy down → status bar shows "not reachable"; Decisions/Overview show the
  existing friendly "start the proxy" hint (already implemented in the readers).
- Empty stream → teaching empty state (as today).
- Disabled nav items are visibly non-interactive (cursor + "soon"), not links.

## Testing
- **Add jsdom + RTL.** Test the high-value interactions: a filter narrows the
  rendered rows; the drawer opens with the correct trace for a clicked row;
  the palette navigates; the active nav item reflects the route.
- **Pure helpers** (filter predicates, time/latency formatters, the
  status-bar health derivation) get plain unit tests.
- `next build` + a short **manual recipe** cover the visual/integration layer
  (the sandbox can't run `next dev`).

## Out of scope (explicit follow-ons)
Spend gauges + Spend page, onboarding wizard, Agents drilldown, Policy editor,
threat-alerts surface, live-tail sampling / patterns-view, and any shadcn CLI
adoption.
