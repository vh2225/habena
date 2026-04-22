# AgentGuard

Open-source (MIT) MCP middleware proxy for AI agent safety — cost limits, guardrails, and human approval.

## Project Structure

```
agentguard/
├── packages/
│   ├── core/                    # MCP proxy + policy engine (open source)
│   │   ├── src/
│   │   │   ├── proxy/           # MCP server + forwarder to downstream servers
│   │   │   ├── identity/        # Agent registration, fingerprinting, instance tracking
│   │   │   ├── policy/          # Rule engine, parser, built-in rules, decisions
│   │   │   ├── threat/          # Threat feed sync + checker
│   │   │   ├── cost/            # Spend tracking, model pricing, budget enforcement
│   │   │   ├── approval/        # Human-in-the-loop approval queue + timeouts
│   │   │   ├── audit/           # Structured logging to SQLite
│   │   │   ├── registry/        # Official, Smithery, Glama registry clients
│   │   │   ├── learning/        # Observe mode + policy profiler
│   │   │   └── cli/             # CLI entrypoint + commands
│   │   └── agentguard.default.yaml  # Default config
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

- **MCP middleware approach**: Agents connect to AgentGuard as their MCP server. AgentGuard proxies to real MCP servers with policy enforcement.
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
agentguard init              # Create ~/.agentguard/config.yaml
agentguard start             # Start proxy (stdio)
agentguard start --http      # Start proxy (HTTP, localhost:7600)
agentguard watch             # Approval terminal
agentguard logs              # Query audit logs
agentguard learn --agent X   # Learning mode
agentguard dashboard         # Open localhost:7700

# Agent identity management
agentguard agent add --name "openclaw" --budget-daily 30   # Register agent
agentguard agent list                                       # List agents + instances
agentguard agent watch openclaw                             # Live activity view
agentguard agent profile research-bot                       # Generate policy from learning
```
