# Security Policy

## Reporting a vulnerability

AgentGuard sits in the authority chain between your AI agent and its downstream MCP servers. A bypass in the policy engine, a leak in the audit log, or a broken approval flow is a real security issue.

**Please do not open a public GitHub issue for security reports.**

Use GitHub's [private vulnerability reporting](https://github.com/vh2225/agentguard/security/advisories/new) to submit a coordinated disclosure. Include:

- A description of the issue
- Steps to reproduce (ideally a minimal proof-of-concept)
- AgentGuard version / commit SHA
- Your assessment of severity

We'll acknowledge within 72 hours and work with you on a fix + coordinated disclosure.

## Scope

In-scope:
- Policy engine evaluation bugs that let a denied tool call through
- Audit-log gaps where tool calls aren't recorded
- Approval bypass (a call that should have paused for a human proceeds silently)
- Credential or token leaks via logs, error messages, or IPC
- Command-injection, path-traversal, or similar in CLI commands
- Dependency vulnerabilities that affect AgentGuard's attack surface

Out-of-scope:
- Issues in downstream MCP servers (report those upstream)
- Issues that require OS-level access to the box running AgentGuard
- Social-engineering or phishing scenarios
- Denial-of-service via flooding (mitigate at network layer)

## Disclosure

Once a fix is merged and released, we'll credit reporters in the release notes unless you prefer anonymity.

## Known transitive advisories

`pnpm audit` currently surfaces advisories against transitive dependencies that don't ship in the AgentGuard runtime:

- `esbuild` / `vite` — pulled in via `vitest` (test runner, dev-dep only). Not on any production code path.
- `hono` — pulled in via `@modelcontextprotocol/sdk` as a transitive. We don't use hono directly; the advisory (HTML injection in hono/jsx SSR) doesn't apply to our use of the SDK. Pinned resolution will arrive when the upstream SDK bumps its dep.

If you're packaging AgentGuard into a system with stricter supply-chain requirements, run `pnpm audit --prod` to get only the runtime advisories. In that view the tree is currently clean.

## Hardening recommendations

If you're deploying AgentGuard, consider:

- Run the proxy as a dedicated user, not as root.
- Keep `~/.agentguard/` mode 700; secrets files mode 600.
- Route approval traffic through a chat channel your team already trusts (Phase 7 spec).
- Run `agentguard doctor` in your health-check system.
- Use `agentguard policy preset cautious` or stricter unless you've audited your rule set.
- Never commit `~/.agentguard/config.yaml` to a public repo — it may contain paths to credential files.
