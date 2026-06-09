# Habena

**Habena — keep your AI agent on a short rein.** Open-source (MIT) MCP middleware proxy for AI agent safety — cost limits, guardrails, and human approval.

> Renamed from AgentGuard. The `agentguard` binary and `~/.agentguard/` config dir keep working as deprecated aliases; new installs use `habena` / `~/.habena/`.

## Project Structure

```
agentguard/
├── packages/
│   ├── core/                    # MCP proxy + policy engine (open source)
│   │   ├── src/
│   │   │   ├── proxy/           # MCP server + forwarder to downstream servers
│   │   │   ├── identity/        # Agent registration, fingerprinting, instance tracking
│   │   │   ├── policy/          # Rule engine, matcher, built-in rules, decisions
│   │   │   ├── threat/          # Local heuristic threat detection (poison/egress/drift)
│   │   │   ├── cost/            # Spend tracking, model pricing, budget enforcement
│   │   │   ├── approval/        # Human-in-the-loop approval queue + timeouts
│   │   │   ├── audit/           # Structured logging to SQLite
│   │   │   ├── registry/        # Official, Smithery, Glama registry clients (stubs)
│   │   │   ├── learn/           # Learning mode: observe audit history, propose rules
│   │   │   └── cli/             # CLI entrypoint + commands
│   │   └── habena.default.yaml  # Default config
│   │
│   └── web/                     # Local dashboard (localhost:7700)
│       └── src/app/             # Next.js app
│
├── docs/specs/                  # Design specs
└── package.json                 # pnpm monorepo root
```

## Tech Stack

- TypeScript, Node.js 20+
- MCP SDK: `@modelcontextprotocol/sdk`
- Smithery: `@smithery/api`
- Storage: `better-sqlite3`
- CLI: `commander` + `chalk` + `inquirer`
- Web: Next.js
- Monorepo: pnpm workspaces

## Key Design Decisions

- **MCP middleware approach**: Agents connect to Habena as their MCP server. Habena proxies to real MCP servers with policy enforcement.
- **Agent identity**: Two-level model — agent type (shared permissions) + instance (tracked separately for budget/audit). Process fingerprinting for verification.
- **Policy engine**: 3-tier evaluation (hard boundaries → session overrides → user rules → defaults → implicit deny). First-match-wins **within** a tier; hard boundaries always win across tiers. Session overrides can bypass user denies but not hard boundaries. Structured decisions (not just boolean). See `packages/core/src/policy/engine.ts` header.
- **Enforcement levels**: advisory (log only), soft_mandatory (ask human), hard_mandatory (block, no override).
- **Threat feed**: Periodically synced threat intelligence (blocklisted servers, pattern signatures, anomaly data). Like antivirus signature updates.
- **Learning mode**: Observe agent behavior, generate least-privilege policy proposal.
- **Fully open source** (MIT). Goal is adoption, not revenue. No gated features.

## Design Spec

Full spec: `docs/specs/2026-04-08-agentguard-design.md`

## Commands

```bash
pnpm install                 # Install dependencies
pnpm build                   # Build all packages
pnpm dev                     # Dev mode (watch)

# CLI (after build)
habena init              # Create ~/.habena/config.yaml
habena start             # Start proxy (stdio)
habena watch             # Approval terminal
habena logs              # Query audit logs
habena learn --agent X   # Learning mode
# Dashboard: the web app in packages/web serves localhost:7700

# Agent identity management
habena agent add --name "openclaw" --budget-daily 30   # Register agent
habena agent list                                       # List agents + instances
habena agent watch openclaw                             # Live activity view
habena agent profile research-bot                       # Generate policy from learning
```
