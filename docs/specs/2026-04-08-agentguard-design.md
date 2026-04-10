# AgentGuard — Design Spec

**Date:** 2026-04-08 (updated 2026-04-09)
**Status:** Approved
**Timeline:** 1-2 months to MVP

## Overview

AgentGuard is an open-core MCP middleware proxy that sits between autonomous AI agents (OpenClaw, CrewAI, AutoGen, etc.) and the MCP servers they consume. It enforces cost limits, blocks dangerous actions, requires human approval for risky operations, and provides audit trails.

**Business model:** Open-core. Free local proxy (open source) + paid cloud dashboard (SaaS).

**Target users:** Developers (v1) → Non-technical users → Businesses/teams (v2+).

## Problem

Autonomous agents like OpenClaw have full system access — shell commands, browser automation, file system, messaging apps, LLM API calls. Running them without guardrails risks:

1. **Financial damage** — runaway API costs, unauthorized purchases
2. **System damage** — destructive commands (rm -rf, DROP TABLE)
3. **Data exfiltration** — sending private files/credentials to external services
4. **Unauthorized communication** — sending emails/messages without approval

No product currently combines cost management, action-level guardrails, and human approval into a single layer for MCP-based agents.

## Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  OpenClaw    │  │ Research Bot │  │  Inbox Agent │
│  instance 1  │  │  instance 1  │  │  instance 1  │
│  instance 2  │  │              │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ MCP             │ MCP             │ MCP
┌──────▼─────────────────▼─────────────────▼──────┐
│              AgentGuard Core (local)             │
│                                                   │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Agent       │  │ Policy   │  │ Threat      │ │
│  │ Registry    │  │ Engine   │  │ Feed        │ │
│  │ (identity + │  │ (per-    │  │ (auto-      │ │
│  │  fingerprint│  │  agent)  │  │  updated)   │ │
│  └─────────────┘  └──────────┘  └─────────────┘ │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Cost        │  │ Approval │  │ Audit       │ │
│  │ Tracker     │  │ Queue    │  │ Logger      │ │
│  └─────────────┘  └──────────┘  └─────────────┘ │
│  ┌─────────────┐  ┌──────────────────────────┐   │
│  │ Learning    │  │ MCP Registry Integration │   │
│  │ Mode        │  │ (Smithery, Glama, etc.)  │   │
│  └─────────────┘  └──────────────────────────┘   │
└──────────────────────┬───────────────────────────┘
                       │ MCP protocol (proxied)
          ┌────────────┼────────────┐
          ▼            ▼            ▼
     github-mcp   gmail-mcp   shell-mcp
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
  AgentGuard Cloud   Threat Feed   Glama API
  (paid: dashboard,  (signatures,  (security
   alerts, teams)    blocklists)    grades)
```

The agent connects to AgentGuard as its MCP server. AgentGuard identifies the agent (fingerprint), loads per-agent permissions, evaluates every tool call against policies and the threat feed, then forwards allowed calls to the real MCP servers downstream.

## Policy Engine

### Evaluation Model (AWS IAM + Cloudflare patterns)

1. Start with implicit DENY for destructive actions
2. Evaluate ALLOW rules (most specific match wins — Little Snitch specificity ladder)
3. Evaluate explicit DENY rules (always override allows — IAM pattern)
4. Hard boundaries can NEVER be overridden (IAM permission boundaries)

### Three-Tier Rule System (Cloudflare pattern)

**Tier 1 — Built-in rules** (shipped with AgentGuard, auto-updated):
- Hard boundaries: cannot be overridden (e.g., `rm -rf /`, `DROP DATABASE`, spend > $500/day)
- Defaults: can be overridden by user rules (e.g., require approval for communications)

**Tier 2 — User rules** (agentguard.yaml):
- Custom allow/deny/approval rules per user's needs

**Tier 3 — Session overrides** (generated from human approvals):
- Temporary rules with auto-expiration (e.g., "allow Gmail sends to example.com for 1 hour")

### Enforcement Levels (HashiCorp Sentinel pattern)

- `advisory` — log + continue, agent proceeds
- `soft_mandatory` — pause + ask human, can approve with reason
- `hard_mandatory` — block, no override possible

### Structured Decisions (OPA pattern)

Every policy evaluation returns a rich object:

```json
{
  "action": "require_approval",
  "reason": "Outbound email to external domain",
  "tool": "gmail_send",
  "risk_level": "medium",
  "enforcement": "soft_mandatory",
  "approval_options": ["allow_once", "allow_1hr", "allow_this_domain", "deny"],
  "context": { "agent": "openclaw", "session_cost_so_far": "$12.40" }
}
```

### Config Format

```yaml
# agentguard.yaml
budget:
  daily: $50
  monthly: $500
  per_session: $20
  per_request: $5
  alert_at: [50%, 80%]
  on_exceed: deny

rules:
  # Block dangerous shell commands
  - match: { tool: "shell_*", args_contain: ["rm -rf", "DROP TABLE", "kill -9"] }
    action: deny
    enforcement: hard_mandatory
    reason: "Destructive system command blocked"

  # Filesystem: block writes outside allowed directories
  - match: { tool: "filesystem_write" }
    action: deny_unless
    condition: { path_starts_with: ["~/workspace", "/tmp"] }

  # Require human approval for all outbound communications
  - match: { tool_tag: "communication" }
    action: require_approval
    enforcement: soft_mandatory
    timeout: 5m

  # Block sending files to unknown external URLs
  - match: { tool: "http_*" }
    action: deny_if
    condition: { body_contains_file_content: true, url_not_in: "~/.agentguard/trusted_domains.txt" }

  # Allow everything else
  - match: { tool: "*" }
    action: allow

approval:
  timeout: 5m
  timeout_action: deny
  batch_similar: true
```

### Learning Mode (Little Snitch + Falco patterns)

1. **Observe phase** — all tool calls allowed but logged (24-48 hours)
2. **Profile generation** — analyze logs, generate least-privilege policy ("this agent uses these 8 tools, calls these 3 domains, writes to these 2 directories")
3. **Review & activate** — user reviews proposed policy, tweaks, switches to enforcement
4. **Anomaly detection** — after learning, flag when an agent calls a tool it has never used before, even if the tool is not explicitly blocked

## Agent Identity & Access Control

### Two-Level Identity Model

Agents are identified at two levels:

- **Agent type** = permission boundary. All instances of the same agent share permissions. Configured once.
- **Instance** = tracking unit. Each running instance gets a unique session ID, its own spend counter, its own audit trail.

### Agent Registration

```yaml
# ~/.agentguard/agents.yaml
agents:
  openclaw:
    fingerprint: "openclaw-v2.1-vinh"
    registered: 2026-04-08
    mode: enforced             # or "learning" or "advisory"
    profile: ~/.agentguard/profiles/openclaw.yaml
    permissions:
      budget:
        daily: $30             # shared across ALL openclaw instances
        per_session: $10       # each instance gets max $10
        max_instances: 5       # hard cap on concurrent instances
      tools:
        allow: ["github_*", "filesystem_read", "shell_execute"]
        deny: ["stripe_*", "gmail_send"]
        require_approval: ["filesystem_write", "http_post"]
      paths:
        writable: ["~/workspace/project-a", "/tmp"]
        readable: ["~/workspace", "~/Documents"]
      domains:
        trusted: ["api.github.com", "api.anthropic.com"]
        blocked: ["*.darkweb.example"]
      mcp_servers:
        allowed: ["github-mcp", "filesystem-mcp"]
        blocked: []

  research-bot:
    fingerprint: "research-bot-v1-vinh"
    mode: learning
    permissions:
      budget:
        daily: $5
      tools:
        allow: ["web_search", "web_fetch"]
        deny: ["shell_*", "filesystem_write"]
```

### Instance Tracking

```
Agent Type (shared permissions)     Instance (tracked separately)
─────────────────────────────       ────────────────────────────
openclaw                            openclaw/session-abc123
  ├── tools: [github, shell, ...]   ├── started: 14:23
  ├── paths: [~/workspace, ...]     ├── task: "research competitors"
  └── domains: [github.com, ...]    ├── spend: $4.20
                                    └── calls: 47

openclaw                            openclaw/session-def456
  (same permissions)                ├── started: 15:01
                                    ├── task: "draft email"
                                    ├── spend: $1.80
                                    └── calls: 12
```

Budget is split: daily budget is shared across all instances of a type, session budget is per-instance. This prevents 5 instances from blowing past the daily cap.

### Fingerprinting Methods

| Method | How | Trust Level |
|---|---|---|
| MCP client metadata | Agent sends name/version in MCP handshake | Low (can be spoofed) |
| Process fingerprint | Check parent PID, binary path, binary hash | Medium |
| API key | Agent passes an AgentGuard-issued key | High |
| mTLS cert | Agent presents a client certificate | Highest (v2) |

v1 uses MCP client metadata + process fingerprint. If `openclaw` connects, we verify the process is actually OpenClaw running from the expected path.

### Connection Flow

```
Agent connects
    │
    ├── Known agent (fingerprint match) → load per-agent policy
    ├── New agent (first connection) → require_approval + start learning
    └── Spoofed agent (fingerprint mismatch) → deny + alert
```

### Named Variants

For different permissions on the same agent software (e.g., work vs personal):

```bash
$ agentguard agent add --name "openclaw-work" --from openclaw --budget-daily 50
$ agentguard agent add --name "openclaw-personal" --from openclaw --budget-daily 10
```

Same fingerprint base, different permission sets.

### Policy Evaluation Order (updated)

```
1. Identify agent (fingerprint)
2. Load agent-specific permissions
3. Check budget (agent's daily pool + instance session limit, hard_mandatory)
4. Check agent's tool allow/deny list
5. Check agent's path/domain restrictions
6. Check threat feed (is this MCP server blocklisted?)
7. Check global policy rules (3-tier engine)
8. Return structured decision
```

## Threat Feed

### Problem

Security threats evolve — MCP servers get compromised, new attack patterns emerge, tool vulnerabilities are discovered. A static policy file can't keep up.

### Solution

AgentGuard periodically syncs a threat database from our cloud, similar to antivirus signature updates.

```
AgentGuard Cloud (threat feed API)
    │ periodic sync (every 6-12 hrs)
    ▼
~/.agentguard/threat-feed.json (local cache)
    │
    ▼
Policy engine checks threat feed on every tool call
```

### What's in the feed

- **Blocklisted MCP servers** — reported malicious or compromised
- **CVE-like advisories** — specific tool versions with known vulnerabilities
- **Updated security grades** — refreshed Glama grades
- **Pattern signatures** — e.g., "any tool that requests `~/.ssh/*` is suspicious"
- **Anomaly data** — aggregated from opted-in users ("this MCP server's error rate spiked 10x today")

### Update frequency

| Tier | Frequency | Content |
|---|---|---|
| Free | Every 24 hours | Core blocklists + critical advisories |
| Pro | Every 6 hours | Full feed + pattern signatures |
| Team | Real-time push | Instant alerts + org-specific threats |

### Network effect

Every AgentGuard user who opts in contributes anonymized usage data to the shared threat intelligence pool. More users = better security for everyone. This is the first network effect in the product — it makes the free tier more valuable as adoption grows.

### Offline behavior

The proxy works offline with stale threat data — still safer than no protection. Last-synced timestamp is shown in the dashboard.

## Cost Tracking & Budget Enforcement

### What gets tracked

- **LLM API calls** — token count x model price (maintained pricing table for Claude, GPT, Gemini, etc.)
- **Paid MCP server calls** — if a tool charges per-call
- **Aggregate spend** — per agent, per session, per day, per month

### Budget enforcement

- Budget limits are `hard_mandatory` — no policy override can bypass them
- At threshold (50%, 80%): send alert
- At limit: deny all cost-incurring calls, return error to agent

## Audit Logging

### Log entry structure

```json
{
  "timestamp": "2026-04-08T14:23:01Z",
  "agent_type": "openclaw",
  "instance_id": "openclaw/session-abc123",
  "tool": "shell_execute",
  "args": { "command": "rm -rf /tmp/old_cache" },
  "mcp_server": "filesystem-server",
  "decision": "allow",
  "rule_matched": "user:allow_tmp_cleanup",
  "tier": "user",
  "threat_feed_check": "clean",
  "cost": null,
  "latency_ms": 42,
  "result_status": "success"
}
```

### Storage

- **Free tier:** SQLite (`~/.agentguard/audit.db`), queryable via CLI, 30 days default retention
- **Paid tier:** Synced to cloud, searchable dashboard, 90 days (Pro) / 1 year (Enterprise)

### What logs enable

- Learning mode profiles
- Anomaly detection
- Marketplace quality data (v2)
- Compliance audit trail

## Approval UX

### v1 — CLI

```
$ agentguard watch

[14:23:01] APPROVAL NEEDED
  Agent: openclaw (instance: session-abc123, spend: $4.20/$30 daily)
  Action: gmail_send
  To: investor@example.com
  Subject: "Follow-up on our meeting"
  
  [a] Allow once
  [s] Allow similar for 1hr
  [d] Deny
  [v] View full details
```

### v1 — Local Web UI

- `localhost:7700` — pending approvals, recent logs, current spend
- No auth (local only), mobile-responsive

### v2 — Push Notifications (paid tier)

- Telegram/Slack/Discord bot for remote approval
- Approve/deny with button tap

### Timeout & Batching

- Default 5 minute timeout, auto-deny
- Batch similar requests into single prompt
- "Allow similar" generates temporary session override rule with auto-expiration

## MCP Registry Integration

AgentGuard integrates with existing registries — it does not replace them.

### Integrated registries

| Registry | Purpose | Trust Level |
|---|---|---|
| Official MCP Registry | Verified, namespace-authenticated servers | `verified` — auto-allow |
| Smithery Connect | Managed proxy, OAuth handling, 6-7K servers | `known` — allow + log |
| Glama | Security grades (A-F), 21K+ servers | Enrichment — grades feed into policy |
| Any user-configured | Self-hosted or other marketplace servers | `unknown` — require approval on first use |

### Registry-aware policy rules

```yaml
registries:
  official:
    url: "https://registry.modelcontextprotocol.io"
    trust_level: verified
  smithery:
    url: "https://smithery.ai"
    trust_level: known
    use_connect: true
  glama:
    url: "https://glama.ai"
    enrich: true
  custom:
    trust_level: unknown

rules:
  - match: { registry: "official", verified: true }
    action: allow
  - match: { registry: "smithery", glama_grade: ["A", "B"] }
    action: allow
  - match: { registry: "smithery", glama_grade: ["D", "F"] }
    action: require_approval
  - match: { registry: "unknown" }
    action: deny
```

### v2 — Own marketplace

Once usage data accumulates through the proxy, launch an AgentGuard marketplace with real-world reliability and cost data per MCP server — data no other marketplace has. This is the Cloudflare playbook (product feeds data feeds next product).

## Cloud Dashboard (Paid Tier)

### Pricing

| Feature | Free (local) | Pro ($29/mo) | Team ($99/mo) |
|---|---|---|---|
| Policy engine | Yes | Yes | Yes |
| Agent identity + per-agent ACL | Yes | Yes | Yes |
| Instance tracking | Yes | Yes | Yes |
| Cost tracking | CLI | Dashboard | Dashboard |
| Audit logs | 30 days local | 90 days searchable | 1 year + export |
| Threat feed | Daily updates | Every 6 hours | Real-time push |
| Alerts | CLI only | Email + Slack | Email + Slack + PagerDuty |
| Agents | Unlimited | Unlimited | Unlimited |
| Team policies | — | — | Shared policies across team |
| SSO | — | — | Yes |
| Remote approval | — | Telegram/Slack bot | Telegram/Slack bot |
| MCP server quality data | — | Yes | Yes |

The free tier must be genuinely useful standalone. Users pay for convenience and team features, not core safety.

## Tech Stack

- **Language:** TypeScript (Node.js) — MCP SDK and Smithery SDK are TypeScript-first
- **MCP:** `@modelcontextprotocol/sdk`
- **Registry:** `@smithery/api` for Smithery Connect
- **Storage:** `better-sqlite3` for local audit logs
- **Config:** YAML (`yaml` package)
- **CLI:** `chalk` + `inquirer`
- **Local Web UI:** Next.js (localhost:7700)
- **Monorepo:** pnpm workspaces or turborepo

## Project Structure

```
agentguard/
├── packages/
│   ├── core/                    # Proxy + policy engine (open source)
│   │   ├── src/
│   │   │   ├── proxy/
│   │   │   │   ├── server.ts          # MCP server agents connect to
│   │   │   │   └── forwarder.ts       # Forwards to downstream MCP servers
│   │   │   ├── identity/
│   │   │   │   ├── registry.ts        # Agent type registration + lookup
│   │   │   │   ├── fingerprint.ts     # Process fingerprinting (PID, binary hash)
│   │   │   │   └── instances.ts       # Instance tracking (per-session state)
│   │   │   ├── policy/
│   │   │   │   ├── engine.ts          # Rule evaluator (deny-overrides-allow)
│   │   │   │   ├── parser.ts          # YAML config parser
│   │   │   │   ├── decisions.ts       # Structured decision types
│   │   │   │   └── built-in-rules.ts  # Hard boundaries + defaults
│   │   │   ├── threat/
│   │   │   │   ├── feed.ts            # Threat feed sync + local cache
│   │   │   │   └── checker.ts         # Check tool calls against threat data
│   │   │   ├── cost/
│   │   │   │   ├── tracker.ts         # Per-agent spend tracking
│   │   │   │   ├── pricing.ts         # Model pricing table
│   │   │   │   └── budget.ts          # Budget enforcement
│   │   │   ├── approval/
│   │   │   │   ├── queue.ts           # Pending approval state
│   │   │   │   └── timeout.ts         # Auto-deny after timeout
│   │   │   ├── audit/
│   │   │   │   ├── logger.ts          # Structured log writer
│   │   │   │   └── store.ts           # SQLite storage
│   │   │   ├── registry/
│   │   │   │   ├── official.ts        # Official MCP Registry client
│   │   │   │   ├── smithery.ts        # Smithery Connect integration
│   │   │   │   ├── glama.ts           # Glama security grade enrichment
│   │   │   │   └── types.ts           # Registry abstractions
│   │   │   ├── learning/
│   │   │   │   ├── observer.ts        # Shadow/observe mode
│   │   │   │   └── profiler.ts        # Generate policy from logs
│   │   │   └── cli/
│   │   │       ├── index.ts           # CLI entrypoint
│   │   │       └── commands/          # start, watch, logs, learn, agent
│   │   └── agentguard.default.yaml
│   │
│   └── web/                     # Local dashboard (open source)
│       └── src/app/             # Next.js app (localhost:7700)
│
├── cloud/                       # Cloud dashboard (closed source, paid tier)
├── docs/
└── package.json                 # Monorepo root
```

## How It Runs

```bash
npm install -g agentguard
agentguard init                                    # Creates ~/.agentguard/config.yaml + agents.yaml
agentguard start                                   # MCP server via stdio (for local agents like OpenClaw)
agentguard start --http                            # MCP server via HTTP on localhost:7600 (for remote/networked agents)
agentguard watch                                   # Approval terminal
agentguard dashboard                               # Opens localhost:7700
agentguard learn --agent openclaw --duration 24h   # Learning mode

# Agent identity management
agentguard agent add --name "openclaw" --budget-daily 30           # Register new agent type
agentguard agent add --name "openclaw-work" --from openclaw        # Create named variant
agentguard agent list                                               # List agents + instances + spend
agentguard agent watch openclaw                                     # Live view of one agent's activity
agentguard agent profile research-bot                               # Generate policy from learned behavior
```

## Agent Configuration (OpenClaw example)

```json
// Before: agent connects to MCP servers directly
{ "mcpServers": { "github": { "url": "..." }, "gmail": { "url": "..." } } }

// After: agent connects to AgentGuard, which routes to real servers
{ "mcpServers": { "agentguard": { "command": "agentguard", "args": ["proxy"] } } }
```

## Out of Scope for v1

- Network-level proxy for non-MCP traffic (v2 — transparent proxy)
- Agent-to-agent communication policies
- Own MCP marketplace (v2 — built from usage data)
- Enterprise SSO / SCIM
- On-premise cloud dashboard deployment
