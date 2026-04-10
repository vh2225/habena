# AgentGuard Phase 1: Core MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working MCP middleware proxy that agents can connect to, with policy-based tool-call interception, per-agent cost tracking, SQLite audit logging, and a CLI that lets users register agents, start the proxy, and view logs.

**Architecture:** The proxy is an MCP server (stdio transport) that agents connect to as their MCP server. On each tool call, it evaluates a 3-tier policy engine (built-in → user → session), checks budget limits, then forwards allowed calls to downstream MCP servers. Decisions and calls are logged to a local SQLite database. Agent identity is managed via a YAML registry; instances are tracked in-memory per session.

**Tech Stack:**
- TypeScript (Node.js 20+)
- `@modelcontextprotocol/sdk` — MCP protocol
- `node-casbin` — policy evaluation engine
- `better-sqlite3` — audit log storage
- `yaml` — config parsing
- `commander` — CLI framework
- `chalk` + `inquirer` — CLI UX
- `vitest` — test framework
- `pnpm` workspaces — monorepo

**Out of scope for Phase 1:** Threat feed, MCP registry integrations (Smithery/Glama/Official), learning mode, local web UI, approval queue (deferred to Phase 3), cloud dashboard.

---

## File Structure

### New files (Phase 1)

```
packages/core/
├── src/
│   ├── config/
│   │   ├── paths.ts              # Resolve ~/.agentguard paths
│   │   └── loader.ts             # Load/merge config.yaml + agents.yaml
│   ├── identity/
│   │   ├── registry.ts           # AgentRegistry: register/lookup agent types
│   │   ├── instances.ts          # InstanceTracker: per-session tracking
│   │   └── types.ts              # AgentType, AgentPermissions, AgentInstance
│   ├── policy/
│   │   ├── decisions.ts          # PolicyDecision, ActionType, EnforcementLevel
│   │   ├── engine.ts             # PolicyEngine: 3-tier evaluation
│   │   ├── matcher.ts            # Rule matching (tool, args, paths, domains)
│   │   ├── built-in-rules.ts     # HARD_BOUNDARIES + DEFAULTS
│   │   └── types.ts              # Rule, MatchCondition, AgentGuardConfig
│   ├── cost/
│   │   ├── pricing.ts            # MODEL_PRICING table
│   │   ├── tracker.ts            # CostTracker: per-instance spend
│   │   └── budget.ts             # Budget enforcement (hard_mandatory)
│   ├── audit/
│   │   ├── types.ts              # AuditEntry type
│   │   ├── store.ts              # SQLite-backed AuditStore
│   │   └── logger.ts             # AuditLogger: log() + query()
│   ├── proxy/
│   │   ├── server.ts             # MCP server (stdio) + tool call handler
│   │   └── forwarder.ts          # Forward calls to downstream MCP servers
│   └── cli/
│       ├── index.ts              # CLI entrypoint (commander)
│       └── commands/
│           ├── init.ts           # agentguard init
│           ├── start.ts          # agentguard start
│           ├── logs.ts           # agentguard logs
│           └── agent.ts          # agentguard agent add/list
└── tests/
    ├── identity/
    │   ├── registry.test.ts
    │   └── instances.test.ts
    ├── policy/
    │   ├── engine.test.ts
    │   └── matcher.test.ts
    ├── cost/
    │   ├── tracker.test.ts
    │   └── budget.test.ts
    ├── audit/
    │   └── store.test.ts
    └── proxy/
        └── server.test.ts
```

### Files to delete (stubs from initial commit)

The initial structure has stubbed files with `throw new Error("Not implemented")`. We'll replace these during implementation. No deletions upfront — we overwrite in place.

### Responsibility per file

| File | Responsibility |
|---|---|
| `config/paths.ts` | Resolve `~/.agentguard/*` paths, handle `~` expansion |
| `config/loader.ts` | Read and parse `config.yaml` and `agents.yaml` into typed objects |
| `identity/types.ts` | Shared types: `AgentType`, `AgentPermissions`, `AgentInstance` |
| `identity/registry.ts` | CRUD for agent types in `agents.yaml` |
| `identity/instances.ts` | In-memory tracking of running instances per type, with spend + call count |
| `policy/types.ts` | Shared types: `Rule`, `MatchCondition`, `AgentGuardConfig` |
| `policy/decisions.ts` | `PolicyDecision`, `ActionType`, `EnforcementLevel` types |
| `policy/matcher.ts` | Single-rule matching: does rule X apply to tool call Y? |
| `policy/engine.ts` | 3-tier evaluation: built-in → user → session. Deny-overrides-allow. |
| `policy/built-in-rules.ts` | Hard-coded `HARD_BOUNDARIES` + `DEFAULTS` rule sets |
| `cost/pricing.ts` | Static `MODEL_PRICING` lookup table |
| `cost/tracker.ts` | Per-instance spend tracking, aggregation |
| `cost/budget.ts` | Budget enforcement — returns `hard_mandatory` deny decision when exceeded |
| `audit/types.ts` | `AuditEntry` type |
| `audit/store.ts` | SQLite backend: schema, insert, query, prune |
| `audit/logger.ts` | Public API: `log(entry)`, `query(filters)` |
| `proxy/server.ts` | MCP server — receives tool calls, calls policy/cost/audit, forwards |
| `proxy/forwarder.ts` | Maintains connections to downstream MCP servers, forwards calls |
| `cli/index.ts` | Commander setup, dispatches to subcommands |
| `cli/commands/init.ts` | Create `~/.agentguard/config.yaml` from template |
| `cli/commands/start.ts` | Start the proxy server |
| `cli/commands/logs.ts` | Query audit store, print formatted results |
| `cli/commands/agent.ts` | Register/list agent types |

---

## Task Sequence

Tasks are ordered bottom-up: types and pure functions first, then modules that compose them, then the proxy and CLI that wire everything together. Each task is a complete unit that can be reviewed and committed independently.

1. Project bootstrap (install deps, set up vitest)
2. Config paths + loader
3. Policy types
4. Policy matcher
5. Built-in rules
6. Policy engine (3-tier evaluation)
7. Identity types
8. Agent registry
9. Instance tracker
10. Cost pricing table
11. Cost tracker
12. Budget enforcement
13. Audit types
14. Audit store (SQLite)
15. Audit logger
16. Proxy forwarder
17. Proxy server (MCP integration)
18. CLI init command
19. CLI agent add/list commands
20. CLI start command
21. CLI logs command
22. End-to-end smoke test

---

## Task 1: Project Bootstrap

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/tests/smoke.test.ts`

- [ ] **Step 1: Update `packages/core/package.json` with final dependencies**

Replace the contents of `packages/core/package.json` with:

```json
{
  "name": "@agentguard/core",
  "version": "0.1.0",
  "description": "AgentGuard MCP proxy — policy engine, cost tracking, and guardrails",
  "type": "module",
  "bin": {
    "agentguard": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^11.0.0",
    "casbin": "^5.30.0",
    "chalk": "^5.3.0",
    "commander": "^12.1.0",
    "inquirer": "^10.2.0",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/inquirer": "^9.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Create smoke test at `packages/core/tests/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Install dependencies**

Run: `cd packages/core && pnpm install`
Expected: installs without errors.

- [ ] **Step 5: Run the smoke test**

Run: `cd packages/core && pnpm test`
Expected: `PASS tests/smoke.test.ts` — 1 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/vitest.config.ts packages/core/tests/smoke.test.ts
git commit -m "chore: bootstrap core package with vitest"
```

---

## Task 2: Config Paths + Loader

**Files:**
- Create: `packages/core/src/config/paths.ts`
- Create: `packages/core/src/config/loader.ts`
- Create: `packages/core/tests/config/paths.test.ts`
- Create: `packages/core/tests/config/loader.test.ts`

- [ ] **Step 1: Write failing test for path expansion**

Create `packages/core/tests/config/paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { expandHome, getConfigPath, getAgentsPath, getAuditDbPath } from "../../src/config/paths.js";
import { homedir } from "node:os";
import { join } from "node:path";

describe("paths", () => {
  it("expands ~ to home directory", () => {
    expect(expandHome("~/foo")).toBe(join(homedir(), "foo"));
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandHome("/tmp/bar")).toBe("/tmp/bar");
  });

  it("returns config.yaml under ~/.agentguard", () => {
    expect(getConfigPath()).toBe(join(homedir(), ".agentguard", "config.yaml"));
  });

  it("returns agents.yaml under ~/.agentguard", () => {
    expect(getAgentsPath()).toBe(join(homedir(), ".agentguard", "agents.yaml"));
  });

  it("returns audit.db under ~/.agentguard", () => {
    expect(getAuditDbPath()).toBe(join(homedir(), ".agentguard", "audit.db"));
  });
});
```

- [ ] **Step 2: Run test — should fail (file missing)**

Run: `pnpm test tests/config/paths.test.ts`
Expected: FAIL — cannot resolve module `../../src/config/paths.js`.

- [ ] **Step 3: Implement `src/config/paths.ts`**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = ".agentguard";

export function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.yaml");
}

export function getAgentsPath(): string {
  return join(getConfigDir(), "agents.yaml");
}

export function getAuditDbPath(): string {
  return join(getConfigDir(), "audit.db");
}
```

- [ ] **Step 4: Run test — should pass**

Run: `pnpm test tests/config/paths.test.ts`
Expected: PASS — 5 passed.

- [ ] **Step 5: Write failing test for YAML loader**

Create `packages/core/tests/config/loader.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadYaml } from "../../src/config/loader.js";

describe("loader", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a YAML file", () => {
    const path = join(dir, "test.yaml");
    writeFileSync(path, "foo: bar\nnum: 42\n");
    const result = loadYaml<{ foo: string; num: number }>(path);
    expect(result).toEqual({ foo: "bar", num: 42 });
  });

  it("returns null when file does not exist", () => {
    const result = loadYaml(join(dir, "missing.yaml"));
    expect(result).toBeNull();
  });

  it("throws on invalid YAML", () => {
    const path = join(dir, "bad.yaml");
    writeFileSync(path, "foo: [unclosed");
    expect(() => loadYaml(path)).toThrow();
  });
});
```

- [ ] **Step 6: Run test — should fail**

Run: `pnpm test tests/config/loader.test.ts`
Expected: FAIL — cannot resolve loader.js.

- [ ] **Step 7: Implement `src/config/loader.ts`**

```ts
import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";

export function loadYaml<T = unknown>(path: string): T | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8");
  return parse(content) as T;
}
```

- [ ] **Step 8: Run test — should pass**

Run: `pnpm test tests/config/loader.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/config/ packages/core/tests/config/
git commit -m "feat(config): add path resolver and YAML loader"
```

---

## Task 3: Policy Types

**Files:**
- Create: `packages/core/src/policy/types.ts`
- Create: `packages/core/src/policy/decisions.ts`

No tests in this task — these are pure type definitions. They get exercised by tests in subsequent tasks.

- [ ] **Step 1: Create `src/policy/types.ts`**

```ts
export interface MatchCondition {
  tool?: string;              // exact match or wildcard (e.g., "shell_*")
  tool_tag?: string;          // semantic tag like "communication", "filesystem"
  args_contain?: string[];    // substring matches against stringified args
  command_matches?: string[]; // for shell_execute: command substring matches
  path_starts_with?: string[];
  registry?: string;          // which MCP registry the server came from
  glama_grade?: string[];     // Phase 2 — placeholder for type compatibility
  url_not_in?: string;        // path to file with allowlist of URLs
  body_contains_file_content?: boolean;
}

export interface Rule {
  match: MatchCondition;
  action: "allow" | "deny" | "require_approval" | "deny_unless" | "deny_if";
  enforcement?: "advisory" | "soft_mandatory" | "hard_mandatory";
  condition?: Record<string, unknown>;
  reason?: string;
  timeout?: string;  // e.g., "5m"
}

export interface BudgetConfig {
  daily?: number;
  monthly?: number;
  per_session?: number;
  per_request?: number;
  alert_at?: number[];
  on_exceed?: "deny" | "warn" | "require_approval";
}

export interface ApprovalConfig {
  timeout?: string;
  timeout_action?: "deny" | "allow";
  batch_similar?: boolean;
}

export interface AgentGuardConfig {
  budget?: BudgetConfig;
  rules?: Rule[];
  approval?: ApprovalConfig;
}
```

- [ ] **Step 2: Create `src/policy/decisions.ts`**

```ts
export type ActionType = "allow" | "deny" | "require_approval";
export type EnforcementLevel = "advisory" | "soft_mandatory" | "hard_mandatory";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RuleTier = "built_in" | "user" | "session";

export interface PolicyDecision {
  action: ActionType;
  reason: string;
  tool: string;
  enforcement: EnforcementLevel;
  risk_level: RiskLevel;
  tier: RuleTier;
  rule_matched?: string;
  context?: {
    agent_type?: string;
    instance_id?: string;
    session_cost?: number;
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/core && pnpm build 2>&1 | head -20`
Expected: no errors from these two files. (There may be errors from other stub files — that's fine at this point.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/policy/types.ts packages/core/src/policy/decisions.ts
git commit -m "feat(policy): define Rule, MatchCondition, PolicyDecision types"
```

---

## Task 4: Policy Matcher

**Files:**
- Create: `packages/core/src/policy/matcher.ts`
- Create: `packages/core/tests/policy/matcher.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/policy/matcher.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matches } from "../../src/policy/matcher.js";
import type { Rule } from "../../src/policy/types.js";

interface Call {
  tool: string;
  args: Record<string, unknown>;
  tool_tag?: string;
  registry?: string;
}

describe("matcher", () => {
  it("matches exact tool name", () => {
    const rule: Rule = { match: { tool: "gmail_send" }, action: "deny" };
    const call: Call = { tool: "gmail_send", args: {} };
    expect(matches(rule, call)).toBe(true);
  });

  it("does not match different tool name", () => {
    const rule: Rule = { match: { tool: "gmail_send" }, action: "deny" };
    const call: Call = { tool: "github_search", args: {} };
    expect(matches(rule, call)).toBe(false);
  });

  it("matches tool wildcard", () => {
    const rule: Rule = { match: { tool: "shell_*" }, action: "deny" };
    const call: Call = { tool: "shell_execute", args: {} };
    expect(matches(rule, call)).toBe(true);
  });

  it("matches wildcard alone", () => {
    const rule: Rule = { match: { tool: "*" }, action: "allow" };
    expect(matches(rule, { tool: "anything", args: {} })).toBe(true);
  });

  it("matches tool_tag", () => {
    const rule: Rule = { match: { tool_tag: "communication" }, action: "require_approval" };
    const call: Call = { tool: "gmail_send", args: {}, tool_tag: "communication" };
    expect(matches(rule, call)).toBe(true);
  });

  it("matches args_contain substring", () => {
    const rule: Rule = { match: { tool: "shell_*", args_contain: ["rm -rf"] }, action: "deny" };
    const call: Call = { tool: "shell_execute", args: { command: "rm -rf /tmp/cache" } };
    expect(matches(rule, call)).toBe(true);
  });

  it("does not match args_contain when absent", () => {
    const rule: Rule = { match: { tool: "shell_*", args_contain: ["rm -rf"] }, action: "deny" };
    const call: Call = { tool: "shell_execute", args: { command: "ls -la" } };
    expect(matches(rule, call)).toBe(false);
  });

  it("matches command_matches for shell", () => {
    const rule: Rule = { match: { command_matches: ["DROP TABLE", "DROP DATABASE"] }, action: "deny" };
    const call: Call = { tool: "shell_execute", args: { command: "psql -c 'DROP TABLE users;'" } };
    expect(matches(rule, call)).toBe(true);
  });

  it("matches registry", () => {
    const rule: Rule = { match: { registry: "official" }, action: "allow" };
    const call: Call = { tool: "github_search", args: {}, registry: "official" };
    expect(matches(rule, call)).toBe(true);
  });

  it("combined criteria: ALL must match (AND semantics)", () => {
    const rule: Rule = {
      match: { tool: "shell_*", args_contain: ["rm"] },
      action: "deny",
    };
    const tooBroad: Call = { tool: "filesystem_write", args: { command: "rm -rf" } };
    expect(matches(rule, tooBroad)).toBe(false);

    const noArgs: Call = { tool: "shell_execute", args: { command: "ls" } };
    expect(matches(rule, noArgs)).toBe(false);

    const both: Call = { tool: "shell_execute", args: { command: "rm -rf" } };
    expect(matches(rule, both)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `pnpm test tests/policy/matcher.test.ts`
Expected: FAIL — cannot resolve matcher.js.

- [ ] **Step 3: Implement `src/policy/matcher.ts`**

```ts
import type { Rule, MatchCondition } from "./types.js";

export interface ToolCallContext {
  tool: string;
  args: Record<string, unknown>;
  tool_tag?: string;
  registry?: string;
  mcp_server?: string;
}

export function matches(rule: Rule, call: ToolCallContext): boolean {
  const m = rule.match;

  if (m.tool !== undefined && !matchToolName(m.tool, call.tool)) return false;
  if (m.tool_tag !== undefined && m.tool_tag !== call.tool_tag) return false;
  if (m.registry !== undefined && m.registry !== call.registry) return false;

  if (m.args_contain) {
    const argsStr = JSON.stringify(call.args);
    if (!m.args_contain.every((needle) => argsStr.includes(needle))) return false;
  }

  if (m.command_matches) {
    const command = String(call.args.command ?? "");
    if (!m.command_matches.some((needle) => command.includes(needle))) return false;
  }

  return true;
}

function matchToolName(pattern: string, tool: string): boolean {
  if (pattern === "*") return true;
  if (pattern === tool) return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return tool.startsWith(prefix);
  }
  return false;
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/policy/matcher.test.ts`
Expected: PASS — 10 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/policy/matcher.ts packages/core/tests/policy/matcher.test.ts
git commit -m "feat(policy): add rule matcher with wildcards, tags, args_contain"
```

---

## Task 5: Built-in Rules

**Files:**
- Create: `packages/core/src/policy/built-in-rules.ts`
- Create: `packages/core/tests/policy/built-in-rules.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/core/tests/policy/built-in-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { HARD_BOUNDARIES, DEFAULTS } from "../../src/policy/built-in-rules.js";
import { matches } from "../../src/policy/matcher.js";

describe("built-in rules", () => {
  it("HARD_BOUNDARIES includes rm -rf /", () => {
    const call = { tool: "shell_execute", args: { command: "rm -rf /" } };
    const matched = HARD_BOUNDARIES.some((r) => matches(r, call));
    expect(matched).toBe(true);
  });

  it("HARD_BOUNDARIES includes DROP DATABASE", () => {
    const call = { tool: "shell_execute", args: { command: "psql -c 'DROP DATABASE prod'" } };
    const matched = HARD_BOUNDARIES.some((r) => matches(r, call));
    expect(matched).toBe(true);
  });

  it("HARD_BOUNDARIES all use hard_mandatory enforcement", () => {
    for (const rule of HARD_BOUNDARIES) {
      expect(rule.enforcement).toBe("hard_mandatory");
    }
  });

  it("HARD_BOUNDARIES all have deny action", () => {
    for (const rule of HARD_BOUNDARIES) {
      expect(rule.action).toBe("deny");
    }
  });

  it("DEFAULTS includes a communication rule", () => {
    const hasCommRule = DEFAULTS.some((r) => r.match.tool_tag === "communication");
    expect(hasCommRule).toBe(true);
  });

  it("DEFAULTS rules are not hard_mandatory", () => {
    for (const rule of DEFAULTS) {
      expect(rule.enforcement).not.toBe("hard_mandatory");
    }
  });

  it("DEFAULTS does not match a normal github_search call", () => {
    const call = { tool: "github_search", args: { query: "AI safety" } };
    const matched = DEFAULTS.some((r) => matches(r, call));
    expect(matched).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — should fail**

Run: `pnpm test tests/policy/built-in-rules.test.ts`
Expected: FAIL — cannot resolve built-in-rules.js.

- [ ] **Step 3: Implement `src/policy/built-in-rules.ts`**

```ts
import type { Rule } from "./types.js";

export const HARD_BOUNDARIES: Rule[] = [
  {
    match: { command_matches: ["rm -rf /", "rm -rf ~", "rm -rf /*", ":(){ :|:& };:"] },
    action: "deny",
    enforcement: "hard_mandatory",
    reason: "Destructive system command — hard blocked",
  },
  {
    match: { command_matches: ["DROP DATABASE", "DROP TABLE", "TRUNCATE TABLE"] },
    action: "deny",
    enforcement: "hard_mandatory",
    reason: "Destructive database command — hard blocked",
  },
  {
    match: { command_matches: ["chmod -R 777 /", "mkfs", "dd if="] },
    action: "deny",
    enforcement: "hard_mandatory",
    reason: "Dangerous system modification — hard blocked",
  },
];

export const DEFAULTS: Rule[] = [
  {
    match: { tool_tag: "communication" },
    action: "require_approval",
    enforcement: "soft_mandatory",
    reason: "Outbound communication requires approval",
    timeout: "5m",
  },
  {
    match: { tool: "filesystem_write" },
    action: "deny_unless",
    enforcement: "soft_mandatory",
    condition: { path_starts_with: ["~/workspace", "/tmp"] },
    reason: "File writes restricted to workspace and tmp",
  },
];
```

- [ ] **Step 4: Run test — should pass**

Run: `pnpm test tests/policy/built-in-rules.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/policy/built-in-rules.ts packages/core/tests/policy/built-in-rules.test.ts
git commit -m "feat(policy): add built-in hard boundaries and default rules"
```

---

## Task 6: Policy Engine (3-tier evaluation)

**Files:**
- Create: `packages/core/src/policy/engine.ts`
- Create: `packages/core/tests/policy/engine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/policy/engine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/policy/engine.js";
import type { Rule } from "../../src/policy/types.js";

describe("PolicyEngine", () => {
  it("hard boundary deny wins over user allow", () => {
    const userRules: Rule[] = [{ match: { tool: "*" }, action: "allow" }];
    const engine = new PolicyEngine(userRules);
    const decision = engine.evaluate({
      tool: "shell_execute",
      args: { command: "rm -rf /" },
    });
    expect(decision.action).toBe("deny");
    expect(decision.enforcement).toBe("hard_mandatory");
    expect(decision.tier).toBe("built_in");
  });

  it("user allow rule permits a normal tool call", () => {
    const userRules: Rule[] = [
      { match: { tool: "github_search" }, action: "allow" },
    ];
    const engine = new PolicyEngine(userRules);
    const decision = engine.evaluate({
      tool: "github_search",
      args: { query: "test" },
    });
    expect(decision.action).toBe("allow");
    expect(decision.tier).toBe("user");
  });

  it("user deny overrides default allow-all", () => {
    const userRules: Rule[] = [
      { match: { tool: "stripe_charge" }, action: "deny", reason: "No payments" },
      { match: { tool: "*" }, action: "allow" },
    ];
    const engine = new PolicyEngine(userRules);
    const decision = engine.evaluate({
      tool: "stripe_charge",
      args: { amount: 100 },
    });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toBe("No payments");
  });

  it("session override takes precedence over user rule for same match", () => {
    const userRules: Rule[] = [
      { match: { tool: "gmail_send" }, action: "deny" },
    ];
    const engine = new PolicyEngine(userRules);
    engine.addSessionOverride(
      { match: { tool: "gmail_send" }, action: "allow" },
      new Date(Date.now() + 60_000)
    );
    const decision = engine.evaluate({
      tool: "gmail_send",
      args: { to: "test@example.com" },
    });
    expect(decision.action).toBe("allow");
    expect(decision.tier).toBe("session");
  });

  it("expired session override is ignored", () => {
    const userRules: Rule[] = [
      { match: { tool: "gmail_send" }, action: "deny" },
    ];
    const engine = new PolicyEngine(userRules);
    engine.addSessionOverride(
      { match: { tool: "gmail_send" }, action: "allow" },
      new Date(Date.now() - 1000)
    );
    const decision = engine.evaluate({
      tool: "gmail_send",
      args: { to: "test@example.com" },
    });
    expect(decision.action).toBe("deny");
  });

  it("default rule matches when no user rule does", () => {
    const engine = new PolicyEngine([]);
    const decision = engine.evaluate({
      tool: "gmail_send",
      args: { to: "x" },
      tool_tag: "communication",
    });
    expect(decision.action).toBe("require_approval");
  });

  it("implicit deny when nothing matches", () => {
    const engine = new PolicyEngine([]);
    const decision = engine.evaluate({
      tool: "unknown_tool",
      args: {},
    });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toContain("No matching rule");
  });

  it("evaluation order: session → user → defaults → hard boundaries → implicit deny", () => {
    // Hard boundary beats everything
    const rules: Rule[] = [{ match: { tool: "*" }, action: "allow" }];
    const engine = new PolicyEngine(rules);
    engine.addSessionOverride(
      { match: { command_matches: ["rm -rf /"] }, action: "allow" },
      new Date(Date.now() + 60_000)
    );
    const decision = engine.evaluate({
      tool: "shell_execute",
      args: { command: "rm -rf /" },
    });
    expect(decision.tier).toBe("built_in");
    expect(decision.enforcement).toBe("hard_mandatory");
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `pnpm test tests/policy/engine.test.ts`
Expected: FAIL — cannot resolve engine.js.

- [ ] **Step 3: Implement `src/policy/engine.ts`**

```ts
import { matches, type ToolCallContext } from "./matcher.js";
import { HARD_BOUNDARIES, DEFAULTS } from "./built-in-rules.js";
import type { Rule } from "./types.js";
import type { PolicyDecision, ActionType, EnforcementLevel, RiskLevel, RuleTier } from "./decisions.js";

interface SessionOverride {
  rule: Rule;
  expiresAt: Date;
}

export class PolicyEngine {
  private userRules: Rule[];
  private sessionOverrides: SessionOverride[] = [];

  constructor(userRules: Rule[] = []) {
    this.userRules = userRules;
  }

  evaluate(call: ToolCallContext): PolicyDecision {
    // 1. Hard boundaries ALWAYS win — check first
    for (const rule of HARD_BOUNDARIES) {
      if (matches(rule, call)) {
        return this.toDecision(rule, "built_in", call);
      }
    }

    // 2. Check active session overrides
    this.clearExpiredOverrides();
    for (const override of this.sessionOverrides) {
      if (matches(override.rule, call)) {
        return this.toDecision(override.rule, "session", call);
      }
    }

    // 3. Check user rules (first match wins in user's declared order)
    for (const rule of this.userRules) {
      if (matches(rule, call)) {
        return this.toDecision(rule, "user", call);
      }
    }

    // 4. Fall back to defaults
    for (const rule of DEFAULTS) {
      if (matches(rule, call)) {
        return this.toDecision(rule, "built_in", call);
      }
    }

    // 5. Implicit deny
    return {
      action: "deny",
      reason: "No matching rule — implicit deny",
      tool: call.tool,
      enforcement: "soft_mandatory",
      risk_level: "medium",
      tier: "built_in",
    };
  }

  addSessionOverride(rule: Rule, expiresAt: Date): void {
    this.sessionOverrides.push({ rule, expiresAt });
  }

  clearExpiredOverrides(): void {
    const now = Date.now();
    this.sessionOverrides = this.sessionOverrides.filter(
      (o) => o.expiresAt.getTime() > now
    );
  }

  private toDecision(rule: Rule, tier: RuleTier, call: ToolCallContext): PolicyDecision {
    const action: ActionType = normalizeAction(rule.action);
    const enforcement: EnforcementLevel = rule.enforcement ?? "soft_mandatory";
    const risk_level: RiskLevel = enforcement === "hard_mandatory" ? "critical" : "medium";

    return {
      action,
      reason: rule.reason ?? `${tier} rule`,
      tool: call.tool,
      enforcement,
      risk_level,
      tier,
    };
  }
}

function normalizeAction(action: Rule["action"]): ActionType {
  if (action === "deny_unless" || action === "deny_if") return "deny";
  return action;
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/policy/engine.test.ts`
Expected: PASS — 8 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/policy/engine.ts packages/core/tests/policy/engine.test.ts
git commit -m "feat(policy): implement 3-tier policy engine with deny-overrides-allow"
```

---

## Task 7: Identity Types

**Files:**
- Create: `packages/core/src/identity/types.ts`

- [ ] **Step 1: Create `src/identity/types.ts`**

```ts
export interface AgentPermissions {
  budget?: {
    daily?: number;
    per_session?: number;
    max_instances?: number;
  };
  tools?: {
    allow?: string[];
    deny?: string[];
    require_approval?: string[];
  };
  paths?: {
    writable?: string[];
    readable?: string[];
  };
  domains?: {
    trusted?: string[];
    blocked?: string[];
  };
  mcp_servers?: {
    allowed?: string[];
    blocked?: string[];
  };
}

export interface AgentType {
  name: string;
  fingerprint: string;
  registered: string;  // ISO 8601 date
  mode: "enforced" | "learning" | "advisory";
  permissions: AgentPermissions;
}

export interface AgentInstance {
  agentType: string;
  instanceId: string;
  startedAt: Date;
  status: "running" | "idle" | "stopped";
  spend: number;
  callCount: number;
}

export interface AgentsFile {
  agents: Record<string, AgentType>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/identity/types.ts
git commit -m "feat(identity): add AgentType, AgentInstance, AgentPermissions types"
```

---

## Task 8: Agent Registry

**Files:**
- Create: `packages/core/src/identity/registry.ts`
- Create: `packages/core/tests/identity/registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/identity/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentRegistry } from "../../src/identity/registry.js";
import type { AgentType } from "../../src/identity/types.js";

describe("AgentRegistry", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-"));
    path = join(dir, "agents.yaml");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts empty when file does not exist", () => {
    const reg = new AgentRegistry(path);
    expect(reg.list()).toEqual([]);
  });

  it("registers and looks up an agent", () => {
    const reg = new AgentRegistry(path);
    const agent: AgentType = {
      name: "openclaw",
      fingerprint: "oc-v1-test",
      registered: "2026-04-09",
      mode: "enforced",
      permissions: { budget: { daily: 30 } },
    };
    reg.register(agent);
    const found = reg.lookup("openclaw");
    expect(found).toEqual(agent);
  });

  it("persists to file and reloads", () => {
    const reg1 = new AgentRegistry(path);
    reg1.register({
      name: "openclaw",
      fingerprint: "oc-v1-test",
      registered: "2026-04-09",
      mode: "enforced",
      permissions: { budget: { daily: 30 } },
    });
    reg1.save();

    const reg2 = new AgentRegistry(path);
    expect(reg2.lookup("openclaw")?.fingerprint).toBe("oc-v1-test");
  });

  it("returns undefined for unknown agent", () => {
    const reg = new AgentRegistry(path);
    expect(reg.lookup("nope")).toBeUndefined();
  });

  it("lists all registered agents", () => {
    const reg = new AgentRegistry(path);
    reg.register({
      name: "openclaw",
      fingerprint: "oc-v1",
      registered: "2026-04-09",
      mode: "enforced",
      permissions: {},
    });
    reg.register({
      name: "research-bot",
      fingerprint: "rb-v1",
      registered: "2026-04-09",
      mode: "learning",
      permissions: {},
    });
    expect(reg.list().map((a) => a.name).sort()).toEqual(["openclaw", "research-bot"]);
  });

  it("createVariant clones an agent with overrides", () => {
    const reg = new AgentRegistry(path);
    reg.register({
      name: "openclaw",
      fingerprint: "oc-v1",
      registered: "2026-04-09",
      mode: "enforced",
      permissions: { budget: { daily: 30 } },
    });
    const variant = reg.createVariant("openclaw-work", "openclaw", {
      budget: { daily: 100 },
    });
    expect(variant.permissions.budget?.daily).toBe(100);
    expect(variant.name).toBe("openclaw-work");
  });

  it("createVariant throws when base agent missing", () => {
    const reg = new AgentRegistry(path);
    expect(() => reg.createVariant("new", "missing", {})).toThrow();
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `pnpm test tests/identity/registry.test.ts`
Expected: FAIL — cannot resolve registry.js.

- [ ] **Step 3: Implement `src/identity/registry.ts`**

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";
import type { AgentType, AgentPermissions, AgentsFile } from "./types.js";

export class AgentRegistry {
  private agents: Map<string, AgentType> = new Map();
  private path: string;

  constructor(path: string) {
    this.path = path;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    const content = readFileSync(this.path, "utf8");
    const data = parse(content) as AgentsFile | null;
    if (!data?.agents) return;
    for (const [name, agent] of Object.entries(data.agents)) {
      this.agents.set(name, { ...agent, name });
    }
  }

  save(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: AgentsFile = {
      agents: Object.fromEntries(this.agents),
    };
    writeFileSync(this.path, stringify(data), "utf8");
  }

  register(agent: AgentType): void {
    this.agents.set(agent.name, agent);
  }

  lookup(name: string): AgentType | undefined {
    return this.agents.get(name);
  }

  lookupByFingerprint(fingerprint: string): AgentType | undefined {
    return Array.from(this.agents.values()).find(
      (a) => a.fingerprint === fingerprint
    );
  }

  list(): AgentType[] {
    return Array.from(this.agents.values());
  }

  createVariant(
    name: string,
    fromAgent: string,
    overrides: Partial<AgentPermissions>
  ): AgentType {
    const base = this.agents.get(fromAgent);
    if (!base) {
      throw new Error(`Base agent not found: ${fromAgent}`);
    }
    const variant: AgentType = {
      name,
      fingerprint: `${base.fingerprint}-${name}`,
      registered: new Date().toISOString().split("T")[0],
      mode: base.mode,
      permissions: { ...base.permissions, ...overrides },
    };
    this.agents.set(name, variant);
    return variant;
  }
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/identity/registry.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/identity/registry.ts packages/core/tests/identity/registry.test.ts
git commit -m "feat(identity): add AgentRegistry with YAML persistence"
```

---

## Task 9: Instance Tracker

**Files:**
- Create: `packages/core/src/identity/instances.ts`
- Create: `packages/core/tests/identity/instances.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/identity/instances.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { InstanceTracker } from "../../src/identity/instances.js";

describe("InstanceTracker", () => {
  let tracker: InstanceTracker;

  beforeEach(() => {
    tracker = new InstanceTracker();
  });

  it("creates an instance with unique id", () => {
    const a = tracker.create("openclaw");
    const b = tracker.create("openclaw");
    expect(a.instanceId).not.toBe(b.instanceId);
  });

  it("instance id includes agent type", () => {
    const i = tracker.create("openclaw");
    expect(i.instanceId).toContain("openclaw/");
  });

  it("tracks spend per instance", () => {
    const i = tracker.create("openclaw");
    tracker.recordSpend(i.instanceId, 1.5);
    tracker.recordSpend(i.instanceId, 2.25);
    expect(tracker.get(i.instanceId)?.spend).toBeCloseTo(3.75);
  });

  it("increments call count on spend", () => {
    const i = tracker.create("openclaw");
    tracker.recordSpend(i.instanceId, 0);
    tracker.recordSpend(i.instanceId, 0);
    expect(tracker.get(i.instanceId)?.callCount).toBe(2);
  });

  it("lists instances by agent type", () => {
    tracker.create("openclaw");
    tracker.create("openclaw");
    tracker.create("research-bot");
    expect(tracker.listByType("openclaw")).toHaveLength(2);
    expect(tracker.listByType("research-bot")).toHaveLength(1);
  });

  it("counts running instances", () => {
    const a = tracker.create("openclaw");
    tracker.create("openclaw");
    tracker.stop(a.instanceId);
    expect(tracker.countRunning("openclaw")).toBe(1);
  });

  it("sums spend across all instances of a type", () => {
    const a = tracker.create("openclaw");
    const b = tracker.create("openclaw");
    tracker.recordSpend(a.instanceId, 10);
    tracker.recordSpend(b.instanceId, 5);
    expect(tracker.totalSpendByType("openclaw")).toBe(15);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `pnpm test tests/identity/instances.test.ts`
Expected: FAIL — cannot resolve instances.js.

- [ ] **Step 3: Implement `src/identity/instances.ts`**

```ts
import { randomBytes } from "node:crypto";
import type { AgentInstance } from "./types.js";

export class InstanceTracker {
  private instances: Map<string, AgentInstance> = new Map();

  create(agentType: string): AgentInstance {
    const instanceId = `${agentType}/session-${randomBytes(4).toString("hex")}`;
    const instance: AgentInstance = {
      agentType,
      instanceId,
      startedAt: new Date(),
      status: "running",
      spend: 0,
      callCount: 0,
    };
    this.instances.set(instanceId, instance);
    return instance;
  }

  get(instanceId: string): AgentInstance | undefined {
    return this.instances.get(instanceId);
  }

  listByType(agentType: string): AgentInstance[] {
    return Array.from(this.instances.values()).filter(
      (i) => i.agentType === agentType
    );
  }

  countRunning(agentType: string): number {
    return this.listByType(agentType).filter((i) => i.status === "running").length;
  }

  totalSpendByType(agentType: string): number {
    return this.listByType(agentType).reduce((sum, i) => sum + i.spend, 0);
  }

  recordSpend(instanceId: string, cost: number): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.spend += cost;
    instance.callCount++;
  }

  stop(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance) instance.status = "stopped";
  }
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/identity/instances.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/identity/instances.ts packages/core/tests/identity/instances.test.ts
git commit -m "feat(identity): add InstanceTracker for per-session state"
```

---

## Task 10: Cost Pricing Table

**Files:**
- Create: `packages/core/src/cost/pricing.ts`
- Create: `packages/core/tests/cost/pricing.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/cost/pricing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { estimateCost, MODEL_PRICING } from "../../src/cost/pricing.js";

describe("pricing", () => {
  it("returns null for unknown model", () => {
    expect(estimateCost("unknown-model", 1000, 1000)).toBeNull();
  });

  it("calculates cost for claude-sonnet-4", () => {
    // claude-sonnet-4: $3 input, $15 output per 1M tokens
    // 1000 input tokens = $0.003, 1000 output = $0.015, total = $0.018
    const cost = estimateCost("claude-sonnet-4", 1000, 1000);
    expect(cost).toBeCloseTo(0.018);
  });

  it("calculates cost for gpt-4o", () => {
    // gpt-4o: $2.50 input, $10 output per 1M tokens
    const cost = estimateCost("gpt-4o", 10000, 5000);
    expect(cost).toBeCloseTo(0.025 + 0.05);
  });

  it("MODEL_PRICING has entries for Claude, GPT, Gemini families", () => {
    const keys = Object.keys(MODEL_PRICING);
    expect(keys.some((k) => k.startsWith("claude"))).toBe(true);
    expect(keys.some((k) => k.startsWith("gpt"))).toBe(true);
    expect(keys.some((k) => k.startsWith("gemini"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — should fail**

Run: `pnpm test tests/cost/pricing.test.ts`
Expected: FAIL — cannot resolve pricing.js.

- [ ] **Step 3: Implement `src/cost/pricing.ts`**

```ts
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-sonnet-4": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-3.5": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10 },
  "gemini-2.5-flash": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}
```

- [ ] **Step 4: Run test — should pass**

Run: `pnpm test tests/cost/pricing.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cost/pricing.ts packages/core/tests/cost/pricing.test.ts
git commit -m "feat(cost): add model pricing table and cost estimator"
```

---

## Task 11: Cost Tracker

**Files:**
- Create: `packages/core/src/cost/tracker.ts`
- Create: `packages/core/tests/cost/tracker.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/cost/tracker.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { CostTracker } from "../../src/cost/tracker.js";

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it("records spend for an instance", () => {
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "gpt-4o",
      cost: 0.50,
      timestamp: new Date(),
    });
    expect(tracker.getInstanceSpend("openclaw/session-a")).toBeCloseTo(0.50);
  });

  it("sums spend across instances of the same type", () => {
    const now = new Date();
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "x",
      cost: 1.00,
      timestamp: now,
    });
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-b",
      tool: "x",
      cost: 2.00,
      timestamp: now,
    });
    expect(tracker.getTypeSpend("openclaw")).toBeCloseTo(3.00);
  });

  it("calculates daily spend for an agent type", () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 25 * 60 * 60 * 1000);
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "x",
      cost: 5.00,
      timestamp: today,
    });
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "x",
      cost: 10.00,
      timestamp: yesterday,
    });
    expect(tracker.getDailySpend("openclaw")).toBeCloseTo(5.00);
  });

  it("returns zero for instance with no spend", () => {
    expect(tracker.getInstanceSpend("nonexistent")).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `pnpm test tests/cost/tracker.test.ts`
Expected: FAIL — cannot resolve tracker.js.

- [ ] **Step 3: Implement `src/cost/tracker.ts`**

```ts
export interface SpendRecord {
  agentType: string;
  instanceId: string;
  tool: string;
  cost: number;
  timestamp: Date;
}

export class CostTracker {
  private records: SpendRecord[] = [];

  record(spend: SpendRecord): void {
    this.records.push(spend);
  }

  getInstanceSpend(instanceId: string): number {
    return this.records
      .filter((r) => r.instanceId === instanceId)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  getTypeSpend(agentType: string): number {
    return this.records
      .filter((r) => r.agentType === agentType)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  getDailySpend(agentType: string): number {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    return this.records
      .filter((r) => r.agentType === agentType && r.timestamp >= cutoff)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  getMonthlySpend(agentType: string): number {
    const cutoff = new Date();
    cutoff.setDate(1);
    cutoff.setHours(0, 0, 0, 0);
    return this.records
      .filter((r) => r.agentType === agentType && r.timestamp >= cutoff)
      .reduce((sum, r) => sum + r.cost, 0);
  }
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/cost/tracker.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cost/tracker.ts packages/core/tests/cost/tracker.test.ts
git commit -m "feat(cost): add CostTracker with per-instance and time-windowed aggregation"
```

---

## Task 12: Budget Enforcement

**Files:**
- Create: `packages/core/src/cost/budget.ts`
- Create: `packages/core/tests/cost/budget.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/cost/budget.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { BudgetEnforcer } from "../../src/cost/budget.js";
import { CostTracker } from "../../src/cost/tracker.js";
import type { BudgetConfig } from "../../src/policy/types.js";

describe("BudgetEnforcer", () => {
  let tracker: CostTracker;
  let budget: BudgetConfig;

  beforeEach(() => {
    tracker = new CostTracker();
    budget = { daily: 30, per_session: 10, per_request: 5, on_exceed: "deny" };
  });

  it("allows when under all limits", () => {
    const enforcer = new BudgetEnforcer(tracker, budget);
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      proposedCost: 1.00,
    });
    expect(decision).toBeNull();
  });

  it("denies when proposed cost exceeds per_request limit", () => {
    const enforcer = new BudgetEnforcer(tracker, budget);
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      proposedCost: 6.00,
    });
    expect(decision?.action).toBe("deny");
    expect(decision?.enforcement).toBe("hard_mandatory");
    expect(decision?.reason).toContain("per-request");
  });

  it("denies when session spend + proposed exceeds per_session", () => {
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "x",
      cost: 9.00,
      timestamp: new Date(),
    });
    const enforcer = new BudgetEnforcer(tracker, budget);
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      proposedCost: 2.00,
    });
    expect(decision?.action).toBe("deny");
    expect(decision?.reason).toContain("session");
  });

  it("denies when daily spend + proposed exceeds daily", () => {
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "x",
      cost: 29.00,
      timestamp: new Date(),
    });
    const enforcer = new BudgetEnforcer(tracker, budget);
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-b",
      proposedCost: 2.00,
    });
    expect(decision?.action).toBe("deny");
    expect(decision?.reason).toContain("daily");
  });

  it("returns null when no budget configured", () => {
    const enforcer = new BudgetEnforcer(tracker, {});
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      proposedCost: 1000.00,
    });
    expect(decision).toBeNull();
  });

  it("budget denial is hard_mandatory with critical risk", () => {
    const enforcer = new BudgetEnforcer(tracker, budget);
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      proposedCost: 6.00,
    });
    expect(decision?.enforcement).toBe("hard_mandatory");
    expect(decision?.risk_level).toBe("critical");
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `pnpm test tests/cost/budget.test.ts`
Expected: FAIL — cannot resolve budget.js.

- [ ] **Step 3: Implement `src/cost/budget.ts`**

```ts
import type { CostTracker } from "./tracker.js";
import type { BudgetConfig } from "../policy/types.js";
import type { PolicyDecision } from "../policy/decisions.js";

export interface BudgetCheckContext {
  agentType: string;
  instanceId: string;
  proposedCost: number;
}

export class BudgetEnforcer {
  constructor(
    private tracker: CostTracker,
    private budget: BudgetConfig
  ) {}

  check(ctx: BudgetCheckContext): PolicyDecision | null {
    const { agentType, instanceId, proposedCost } = ctx;

    if (this.budget.per_request !== undefined && proposedCost > this.budget.per_request) {
      return this.denial(`Exceeds per-request limit of $${this.budget.per_request}`);
    }

    if (this.budget.per_session !== undefined) {
      const sessionSpend = this.tracker.getInstanceSpend(instanceId);
      if (sessionSpend + proposedCost > this.budget.per_session) {
        return this.denial(
          `Exceeds session limit: $${sessionSpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${this.budget.per_session}`
        );
      }
    }

    if (this.budget.daily !== undefined) {
      const dailySpend = this.tracker.getDailySpend(agentType);
      if (dailySpend + proposedCost > this.budget.daily) {
        return this.denial(
          `Exceeds daily limit: $${dailySpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${this.budget.daily}`
        );
      }
    }

    if (this.budget.monthly !== undefined) {
      const monthlySpend = this.tracker.getMonthlySpend(agentType);
      if (monthlySpend + proposedCost > this.budget.monthly) {
        return this.denial(
          `Exceeds monthly limit: $${monthlySpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${this.budget.monthly}`
        );
      }
    }

    return null;
  }

  private denial(reason: string): PolicyDecision {
    return {
      action: "deny",
      reason,
      tool: "*",
      enforcement: "hard_mandatory",
      risk_level: "critical",
      tier: "built_in",
    };
  }
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/cost/budget.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cost/budget.ts packages/core/tests/cost/budget.test.ts
git commit -m "feat(cost): add BudgetEnforcer with hard_mandatory denials"
```

---

## Task 13: Audit Types

**Files:**
- Create: `packages/core/src/audit/types.ts`

- [ ] **Step 1: Create `src/audit/types.ts`**

```ts
export interface AuditEntry {
  timestamp: Date;
  agentType: string;
  instanceId: string;
  tool: string;
  args: Record<string, unknown>;
  mcpServer: string;
  decision: "allow" | "deny" | "require_approval";
  tier: "built_in" | "user" | "session";
  ruleMatched?: string;
  reason?: string;
  cost: number | null;
  latencyMs: number | null;
  resultStatus: "success" | "error" | "timeout" | "pending";
}

export interface AuditQueryFilters {
  agentType?: string;
  instanceId?: string;
  since?: Date;
  decision?: "allow" | "deny" | "require_approval";
  limit?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/audit/types.ts
git commit -m "feat(audit): add AuditEntry and AuditQueryFilters types"
```

---

## Task 14: Audit Store (SQLite)

**Files:**
- Create: `packages/core/src/audit/store.ts`
- Create: `packages/core/tests/audit/store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/audit/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditStore } from "../../src/audit/store.js";
import type { AuditEntry } from "../../src/audit/types.js";

function sampleEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date(),
    agentType: "openclaw",
    instanceId: "openclaw/session-a",
    tool: "github_search",
    args: { query: "test" },
    mcpServer: "github-mcp",
    decision: "allow",
    tier: "user",
    ruleMatched: "user:allow-github",
    reason: "github allowed",
    cost: 0.01,
    latencyMs: 42,
    resultStatus: "success",
    ...overrides,
  };
}

describe("AuditStore", () => {
  let dir: string;
  let dbPath: string;
  let store: AuditStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-"));
    dbPath = join(dir, "audit.db");
    store = new AuditStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the database file", () => {
    store.insert(sampleEntry());
    expect(store.query({}).length).toBe(1);
  });

  it("inserts and retrieves an entry", () => {
    const entry = sampleEntry({ tool: "custom_tool" });
    store.insert(entry);
    const results = store.query({});
    expect(results[0].tool).toBe("custom_tool");
    expect(results[0].args).toEqual({ query: "test" });
  });

  it("filters by agent type", () => {
    store.insert(sampleEntry({ agentType: "openclaw" }));
    store.insert(sampleEntry({ agentType: "research-bot" }));
    const results = store.query({ agentType: "openclaw" });
    expect(results).toHaveLength(1);
    expect(results[0].agentType).toBe("openclaw");
  });

  it("filters by instance id", () => {
    store.insert(sampleEntry({ instanceId: "a" }));
    store.insert(sampleEntry({ instanceId: "b" }));
    expect(store.query({ instanceId: "a" })).toHaveLength(1);
  });

  it("filters by decision", () => {
    store.insert(sampleEntry({ decision: "allow" }));
    store.insert(sampleEntry({ decision: "deny" }));
    expect(store.query({ decision: "deny" })).toHaveLength(1);
  });

  it("filters by timestamp", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const recent = new Date();
    store.insert(sampleEntry({ timestamp: old }));
    store.insert(sampleEntry({ timestamp: recent }));
    const results = store.query({ since: new Date(Date.now() - 60_000) });
    expect(results).toHaveLength(1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 10; i++) {
      store.insert(sampleEntry());
    }
    expect(store.query({ limit: 3 })).toHaveLength(3);
  });

  it("orders results newest-first", () => {
    store.insert(sampleEntry({
      timestamp: new Date("2026-04-01"),
      ruleMatched: "first",
    }));
    store.insert(sampleEntry({
      timestamp: new Date("2026-04-02"),
      ruleMatched: "second",
    }));
    const results = store.query({});
    expect(results[0].ruleMatched).toBe("second");
  });

  it("prunes entries older than retention", () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    store.insert(sampleEntry({ timestamp: old }));
    store.insert(sampleEntry({ timestamp: new Date() }));
    const deleted = store.prune(30);
    expect(deleted).toBe(1);
    expect(store.query({}).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `pnpm test tests/audit/store.test.ts`
Expected: FAIL — cannot resolve store.js.

- [ ] **Step 3: Implement `src/audit/store.ts`**

```ts
import Database from "better-sqlite3";
import { dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { AuditEntry, AuditQueryFilters } from "./types.js";

export class AuditStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        mcp_server TEXT NOT NULL,
        decision TEXT NOT NULL,
        tier TEXT NOT NULL,
        rule_matched TEXT,
        reason TEXT,
        cost REAL,
        latency_ms INTEGER,
        result_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_agent_type ON audit_entries(agent_type);
      CREATE INDEX IF NOT EXISTS idx_audit_instance_id ON audit_entries(instance_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_entries(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_entries(decision);
    `);
  }

  insert(entry: AuditEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_entries (
        timestamp, agent_type, instance_id, tool, args, mcp_server,
        decision, tier, rule_matched, reason, cost, latency_ms, result_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.timestamp.toISOString(),
      entry.agentType,
      entry.instanceId,
      entry.tool,
      JSON.stringify(entry.args),
      entry.mcpServer,
      entry.decision,
      entry.tier,
      entry.ruleMatched ?? null,
      entry.reason ?? null,
      entry.cost,
      entry.latencyMs,
      entry.resultStatus
    );
  }

  query(filters: AuditQueryFilters): AuditEntry[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.agentType) {
      where.push("agent_type = ?");
      params.push(filters.agentType);
    }
    if (filters.instanceId) {
      where.push("instance_id = ?");
      params.push(filters.instanceId);
    }
    if (filters.since) {
      where.push("timestamp >= ?");
      params.push(filters.since.toISOString());
    }
    if (filters.decision) {
      where.push("decision = ?");
      params.push(filters.decision);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit = filters.limit ?? 1000;
    const sql = `SELECT * FROM audit_entries ${whereClause} ORDER BY timestamp DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as Record<string, unknown>[];

    return rows.map(this.rowToEntry);
  }

  prune(retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = this.db
      .prepare("DELETE FROM audit_entries WHERE timestamp < ?")
      .run(cutoff.toISOString());
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private rowToEntry(row: Record<string, unknown>): AuditEntry {
    return {
      timestamp: new Date(row.timestamp as string),
      agentType: row.agent_type as string,
      instanceId: row.instance_id as string,
      tool: row.tool as string,
      args: JSON.parse(row.args as string),
      mcpServer: row.mcp_server as string,
      decision: row.decision as AuditEntry["decision"],
      tier: row.tier as AuditEntry["tier"],
      ruleMatched: (row.rule_matched as string | null) ?? undefined,
      reason: (row.reason as string | null) ?? undefined,
      cost: row.cost as number | null,
      latencyMs: row.latency_ms as number | null,
      resultStatus: row.result_status as AuditEntry["resultStatus"],
    };
  }
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/audit/store.test.ts`
Expected: PASS — 9 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/audit/store.ts packages/core/tests/audit/store.test.ts
git commit -m "feat(audit): add SQLite-backed AuditStore with filters and pruning"
```

---

## Task 15: Audit Logger

**Files:**
- Create: `packages/core/src/audit/logger.ts`

- [ ] **Step 1: Create `src/audit/logger.ts`**

This is a thin wrapper over `AuditStore` that may be extended later with streaming, cloud sync, etc. No new tests — it delegates directly to the store which is already tested.

```ts
import { AuditStore } from "./store.js";
import type { AuditEntry, AuditQueryFilters } from "./types.js";

export class AuditLogger {
  private store: AuditStore;

  constructor(dbPath: string) {
    this.store = new AuditStore(dbPath);
  }

  log(entry: AuditEntry): void {
    this.store.insert(entry);
  }

  query(filters: AuditQueryFilters): AuditEntry[] {
    return this.store.query(filters);
  }

  prune(retentionDays: number): number {
    return this.store.prune(retentionDays);
  }

  close(): void {
    this.store.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/audit/logger.ts
git commit -m "feat(audit): add AuditLogger wrapper over AuditStore"
```

---

## Task 16: Proxy Forwarder

**Files:**
- Create: `packages/core/src/proxy/forwarder.ts`
- Create: `packages/core/tests/proxy/forwarder.test.ts`

For Phase 1, the forwarder holds a minimal registry of downstream MCP server configs. Actual stdio/HTTP connection to real downstream servers is a later task — for now we test the config management.

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/proxy/forwarder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Forwarder } from "../../src/proxy/forwarder.js";

describe("Forwarder", () => {
  it("registers a downstream server", () => {
    const fwd = new Forwarder();
    fwd.addServer({ name: "github", command: "mcp-server-github" });
    expect(fwd.listServers().map((s) => s.name)).toContain("github");
  });

  it("routes tool name prefix to server", () => {
    const fwd = new Forwarder();
    fwd.addServer({ name: "github", command: "x", toolPrefixes: ["github_"] });
    fwd.addServer({ name: "filesystem", command: "y", toolPrefixes: ["filesystem_"] });
    expect(fwd.routeFor("github_search")?.name).toBe("github");
    expect(fwd.routeFor("filesystem_write")?.name).toBe("filesystem");
  });

  it("returns undefined when no route matches", () => {
    const fwd = new Forwarder();
    fwd.addServer({ name: "github", command: "x", toolPrefixes: ["github_"] });
    expect(fwd.routeFor("unknown_tool")).toBeUndefined();
  });

  it("removes a server", () => {
    const fwd = new Forwarder();
    fwd.addServer({ name: "github", command: "x" });
    fwd.removeServer("github");
    expect(fwd.listServers()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `pnpm test tests/proxy/forwarder.test.ts`
Expected: FAIL — cannot resolve forwarder.js.

- [ ] **Step 3: Implement `src/proxy/forwarder.ts`**

```ts
export interface DownstreamServer {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  toolPrefixes?: string[];
  registry?: string;
}

export class Forwarder {
  private servers: Map<string, DownstreamServer> = new Map();

  addServer(server: DownstreamServer): void {
    this.servers.set(server.name, server);
  }

  removeServer(name: string): void {
    this.servers.delete(name);
  }

  listServers(): DownstreamServer[] {
    return Array.from(this.servers.values());
  }

  routeFor(toolName: string): DownstreamServer | undefined {
    for (const server of this.servers.values()) {
      if (!server.toolPrefixes) continue;
      if (server.toolPrefixes.some((prefix) => toolName.startsWith(prefix))) {
        return server;
      }
    }
    return undefined;
  }

  async forward(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // TODO(Phase 2): actually connect to the downstream MCP server and forward
    // For Phase 1, this is a stub that will be wired to real MCP clients later.
    throw new Error("Forwarder.forward not yet wired to downstream MCP clients");
  }
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/proxy/forwarder.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proxy/forwarder.ts packages/core/tests/proxy/forwarder.test.ts
git commit -m "feat(proxy): add Forwarder with tool-prefix routing"
```

---

## Task 17: Proxy Server (MCP Integration)

**Files:**
- Create: `packages/core/src/proxy/server.ts`
- Create: `packages/core/tests/proxy/server.test.ts`

This task wires up the actual `@modelcontextprotocol/sdk` MCP server. The server exposes itself to agents as an MCP server; when an agent calls a tool, the server evaluates policy and budget, logs the result, and (if allowed) forwards. Since full end-to-end MCP testing requires a real transport, we unit-test the policy-dispatch logic in isolation.

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/proxy/server.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProxyDispatcher } from "../../src/proxy/server.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { CostTracker } from "../../src/cost/tracker.js";
import { BudgetEnforcer } from "../../src/cost/budget.js";
import { AuditLogger } from "../../src/audit/logger.js";
import { InstanceTracker } from "../../src/identity/instances.js";
import { Forwarder } from "../../src/proxy/forwarder.js";

describe("ProxyDispatcher", () => {
  let dir: string;
  let dispatcher: ProxyDispatcher;
  let audit: AuditLogger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-"));
    const policy = new PolicyEngine([
      { match: { tool: "github_*" }, action: "allow" },
      { match: { tool: "stripe_*" }, action: "deny", reason: "No payments" },
    ]);
    const tracker = new CostTracker();
    const budget = new BudgetEnforcer(tracker, { per_request: 5 });
    audit = new AuditLogger(join(dir, "audit.db"));
    const instances = new InstanceTracker();
    const forwarder = new Forwarder();
    forwarder.addServer({ name: "github", command: "x", toolPrefixes: ["github_"] });

    dispatcher = new ProxyDispatcher({
      policy,
      tracker,
      budget,
      audit,
      instances,
      forwarder,
    });
  });

  afterEach(() => {
    audit.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("denies when policy denies", async () => {
    const result = await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "stripe_charge",
      args: { amount: 100 },
      estimatedCost: 0,
    });
    expect(result.decision.action).toBe("deny");
    expect(result.forwarded).toBe(false);
  });

  it("denies when budget exceeds per_request", async () => {
    const result = await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "github_search",
      args: {},
      estimatedCost: 10,
    });
    expect(result.decision.action).toBe("deny");
    expect(result.decision.reason).toContain("per-request");
  });

  it("logs every decision to the audit store", async () => {
    await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "github_search",
      args: { query: "safety" },
      estimatedCost: 0.01,
    });
    await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "stripe_charge",
      args: {},
      estimatedCost: 0,
    });
    const logs = audit.query({});
    expect(logs).toHaveLength(2);
    expect(logs.some((l) => l.decision === "allow")).toBe(true);
    expect(logs.some((l) => l.decision === "deny")).toBe(true);
  });

  it("records cost for allowed calls", async () => {
    await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "github_search",
      args: {},
      estimatedCost: 0.50,
    });
    const logs = audit.query({});
    expect(logs[0].cost).toBeCloseTo(0.50);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `pnpm test tests/proxy/server.test.ts`
Expected: FAIL — cannot resolve server.js.

- [ ] **Step 3: Implement `src/proxy/server.ts`**

```ts
import type { PolicyEngine } from "../policy/engine.js";
import type { CostTracker } from "../cost/tracker.js";
import type { BudgetEnforcer } from "../cost/budget.js";
import type { AuditLogger } from "../audit/logger.js";
import type { InstanceTracker } from "../identity/instances.js";
import type { Forwarder } from "./forwarder.js";
import type { PolicyDecision } from "../policy/decisions.js";

export interface DispatcherDeps {
  policy: PolicyEngine;
  tracker: CostTracker;
  budget: BudgetEnforcer;
  audit: AuditLogger;
  instances: InstanceTracker;
  forwarder: Forwarder;
}

export interface ToolCallRequest {
  agentType: string;
  instanceId: string;
  tool: string;
  args: Record<string, unknown>;
  estimatedCost: number;
  mcpServer?: string;
}

export interface ToolCallResult {
  decision: PolicyDecision;
  forwarded: boolean;
  result?: unknown;
  error?: string;
}

/**
 * ProxyDispatcher is the pure-logic core of the proxy.
 * The MCP server transport (stdio/HTTP) wraps this class and
 * translates MCP protocol messages into handleToolCall() invocations.
 */
export class ProxyDispatcher {
  constructor(private deps: DispatcherDeps) {}

  async handleToolCall(req: ToolCallRequest): Promise<ToolCallResult> {
    const startTime = Date.now();

    // 1. Budget check (hard_mandatory, runs first)
    const budgetDecision = this.deps.budget.check({
      agentType: req.agentType,
      instanceId: req.instanceId,
      proposedCost: req.estimatedCost,
    });

    let decision: PolicyDecision;
    if (budgetDecision) {
      decision = budgetDecision;
    } else {
      // 2. Policy engine evaluation
      decision = this.deps.policy.evaluate({
        tool: req.tool,
        args: req.args,
      });
    }

    // 3. Log the decision
    const latencyMs = Date.now() - startTime;
    this.deps.audit.log({
      timestamp: new Date(),
      agentType: req.agentType,
      instanceId: req.instanceId,
      tool: req.tool,
      args: req.args,
      mcpServer: req.mcpServer ?? this.deps.forwarder.routeFor(req.tool)?.name ?? "unknown",
      decision: decision.action,
      tier: decision.tier,
      ruleMatched: decision.rule_matched,
      reason: decision.reason,
      cost: decision.action === "allow" ? req.estimatedCost : null,
      latencyMs,
      resultStatus: decision.action === "allow" ? "success" : "error",
    });

    // 4. Record spend + forward if allowed
    if (decision.action === "allow") {
      this.deps.tracker.record({
        agentType: req.agentType,
        instanceId: req.instanceId,
        tool: req.tool,
        cost: req.estimatedCost,
        timestamp: new Date(),
      });
      this.deps.instances.recordSpend(req.instanceId, req.estimatedCost);

      // For Phase 1, we mark as forwarded but don't actually invoke forwarder.forward()
      // since that requires real MCP client connections (Phase 2).
      return { decision, forwarded: true, result: null };
    }

    return { decision, forwarded: false };
  }
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm test tests/proxy/server.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proxy/server.ts packages/core/tests/proxy/server.test.ts
git commit -m "feat(proxy): add ProxyDispatcher wiring policy+budget+audit+instances"
```

---

## Task 18: CLI init Command

**Files:**
- Create: `packages/core/src/cli/commands/init.ts`

- [ ] **Step 1: Create `src/cli/commands/init.ts`**

```ts
import { writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { getConfigDir, getConfigPath, getAgentsPath } from "../../config/paths.js";

const DEFAULT_CONFIG = `# AgentGuard configuration
budget:
  daily: 50
  monthly: 500
  per_session: 20
  per_request: 5
  alert_at: [50, 80]
  on_exceed: deny

rules:
  # Block destructive shell commands
  - match:
      tool: "shell_*"
      args_contain: ["rm -rf", "DROP TABLE"]
    action: deny
    enforcement: hard_mandatory
    reason: "Destructive command blocked"

  # Require approval for outbound communications
  - match:
      tool_tag: communication
    action: require_approval
    enforcement: soft_mandatory
    reason: "Outbound communication"

  # Allow everything else
  - match:
      tool: "*"
    action: allow
`;

const DEFAULT_AGENTS = `# Registered agents
# Add agents with: agentguard agent add --name <name> --budget-daily <amount>
agents: {}
`;

export async function initCommand(options: { force?: boolean } = {}): Promise<void> {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(chalk.green(`✓ Created ${dir}`));
  }

  const configPath = getConfigPath();
  if (existsSync(configPath) && !options.force) {
    console.log(chalk.yellow(`! ${configPath} already exists (use --force to overwrite)`));
  } else {
    writeFileSync(configPath, DEFAULT_CONFIG, "utf8");
    console.log(chalk.green(`✓ Created ${configPath}`));
  }

  const agentsPath = getAgentsPath();
  if (existsSync(agentsPath) && !options.force) {
    console.log(chalk.yellow(`! ${agentsPath} already exists (use --force to overwrite)`));
  } else {
    writeFileSync(agentsPath, DEFAULT_AGENTS, "utf8");
    console.log(chalk.green(`✓ Created ${agentsPath}`));
  }

  console.log(chalk.cyan("\nNext steps:"));
  console.log("  agentguard agent add --name openclaw --budget-daily 30");
  console.log("  agentguard start");
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/cli/commands/init.ts
git commit -m "feat(cli): add init command to create default config files"
```

---

## Task 19: CLI agent add/list Commands

**Files:**
- Create: `packages/core/src/cli/commands/agent.ts`

- [ ] **Step 1: Create `src/cli/commands/agent.ts`**

```ts
import chalk from "chalk";
import { getAgentsPath } from "../../config/paths.js";
import { AgentRegistry } from "../../identity/registry.js";
import type { AgentType } from "../../identity/types.js";

function generateFingerprint(name: string): string {
  return `${name}-${Date.now().toString(36)}`;
}

export async function agentAddCommand(options: {
  name: string;
  budgetDaily?: number;
  budgetPerSession?: number;
  from?: string;
}): Promise<void> {
  const registry = new AgentRegistry(getAgentsPath());

  if (options.from) {
    const variant = registry.createVariant(options.name, options.from, {
      budget: {
        daily: options.budgetDaily,
        per_session: options.budgetPerSession,
      },
    });
    registry.save();
    console.log(chalk.green(`✓ Created variant "${options.name}" from "${options.from}"`));
    console.log(`  Fingerprint: ${variant.fingerprint}`);
    return;
  }

  const agent: AgentType = {
    name: options.name,
    fingerprint: generateFingerprint(options.name),
    registered: new Date().toISOString().split("T")[0],
    mode: "enforced",
    permissions: {
      budget: {
        daily: options.budgetDaily,
        per_session: options.budgetPerSession,
      },
    },
  };

  registry.register(agent);
  registry.save();
  console.log(chalk.green(`✓ Registered agent "${options.name}"`));
  console.log(`  Fingerprint: ${agent.fingerprint}`);
  console.log(`  Daily budget: $${options.budgetDaily ?? "unset"}`);
}

export async function agentListCommand(): Promise<void> {
  const registry = new AgentRegistry(getAgentsPath());
  const agents = registry.list();

  if (agents.length === 0) {
    console.log(chalk.yellow("No agents registered."));
    console.log("Add one with: agentguard agent add --name <name> --budget-daily <amount>");
    return;
  }

  console.log(chalk.bold("\nRegistered agents:\n"));
  const nameWidth = Math.max(...agents.map((a) => a.name.length), 10);
  console.log(
    `  ${"NAME".padEnd(nameWidth)}  ${"MODE".padEnd(10)}  ${"BUDGET".padEnd(12)}  FINGERPRINT`
  );
  for (const agent of agents) {
    const budget = agent.permissions.budget?.daily
      ? `$${agent.permissions.budget.daily}/day`
      : "none";
    console.log(
      `  ${agent.name.padEnd(nameWidth)}  ${agent.mode.padEnd(10)}  ${budget.padEnd(12)}  ${agent.fingerprint}`
    );
  }
  console.log();
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/cli/commands/agent.ts
git commit -m "feat(cli): add agent add and list subcommands"
```

---

## Task 20: CLI start Command

**Files:**
- Create: `packages/core/src/cli/commands/start.ts`

For Phase 1, `start` wires everything together into a `ProxyDispatcher` and exposes it over an MCP stdio server. The MCP server uses `@modelcontextprotocol/sdk` to listen for tool-call requests from agents. Since the forwarder's actual forwarding is Phase 2, the server stubs responses with "dispatched" info.

- [ ] **Step 1: Create `src/cli/commands/start.ts`**

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import chalk from "chalk";
import { getConfigPath, getAgentsPath, getAuditDbPath } from "../../config/paths.js";
import { loadYaml } from "../../config/loader.js";
import type { AgentGuardConfig } from "../../policy/types.js";
import { PolicyEngine } from "../../policy/engine.js";
import { CostTracker } from "../../cost/tracker.js";
import { BudgetEnforcer } from "../../cost/budget.js";
import { AuditLogger } from "../../audit/logger.js";
import { InstanceTracker } from "../../identity/instances.js";
import { AgentRegistry } from "../../identity/registry.js";
import { Forwarder } from "../../proxy/forwarder.js";
import { ProxyDispatcher } from "../../proxy/server.js";

export async function startCommand(): Promise<void> {
  // Load config
  const config = loadYaml<AgentGuardConfig>(getConfigPath()) ?? {};
  const rules = config.rules ?? [];
  const budgetConfig = config.budget ?? {};

  // Wire up dependencies
  const policy = new PolicyEngine(rules);
  const tracker = new CostTracker();
  const budget = new BudgetEnforcer(tracker, budgetConfig);
  const audit = new AuditLogger(getAuditDbPath());
  const instances = new InstanceTracker();
  const forwarder = new Forwarder();

  // Load registered agents (not wired to fingerprint verification in Phase 1,
  // but we load them to validate they exist)
  const agentRegistry = new AgentRegistry(getAgentsPath());
  const agents = agentRegistry.list();

  const dispatcher = new ProxyDispatcher({
    policy,
    tracker,
    budget,
    audit,
    instances,
    forwarder,
  });

  // Set up MCP server
  const server = new Server(
    { name: "agentguard", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "agentguard_proxy",
        description:
          "AgentGuard generic proxy tool. Pass through any downstream tool call via arguments: tool_name, tool_args.",
        inputSchema: {
          type: "object",
          properties: {
            tool_name: { type: "string", description: "The downstream tool to invoke" },
            tool_args: { type: "object", description: "Arguments for the downstream tool" },
            estimated_cost: { type: "number", description: "Estimated cost in USD" },
            agent_type: { type: "string", description: "Agent type identifier" },
          },
          required: ["tool_name", "agent_type"],
        },
      },
    ],
  }));

  // Track one instance per connected agent in Phase 1
  const instanceByAgent = new Map<string, string>();

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments as {
      tool_name: string;
      tool_args?: Record<string, unknown>;
      estimated_cost?: number;
      agent_type: string;
    };

    let instanceId = instanceByAgent.get(args.agent_type);
    if (!instanceId) {
      const instance = instances.create(args.agent_type);
      instanceId = instance.instanceId;
      instanceByAgent.set(args.agent_type, instanceId);
    }

    const result = await dispatcher.handleToolCall({
      agentType: args.agent_type,
      instanceId,
      tool: args.tool_name,
      args: args.tool_args ?? {},
      estimatedCost: args.estimated_cost ?? 0,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              decision: result.decision.action,
              reason: result.decision.reason,
              enforcement: result.decision.enforcement,
              forwarded: result.forwarded,
            },
            null,
            2
          ),
        },
      ],
      isError: result.decision.action !== "allow",
    };
  });

  // Announce startup to stderr (stdout is reserved for MCP protocol)
  console.error(chalk.green("AgentGuard proxy started (stdio transport)"));
  console.error(chalk.gray(`Config: ${getConfigPath()}`));
  console.error(chalk.gray(`Audit: ${getAuditDbPath()}`));
  console.error(chalk.gray(`Registered agents: ${agents.length}`));

  // Graceful shutdown
  const shutdown = () => {
    console.error(chalk.yellow("\nShutting down AgentGuard..."));
    audit.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 2: Build and verify it compiles**

Run: `cd packages/core && pnpm build`
Expected: TypeScript compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/cli/commands/start.ts
git commit -m "feat(cli): add start command wiring MCP stdio server to ProxyDispatcher"
```

---

## Task 21: CLI logs Command

**Files:**
- Create: `packages/core/src/cli/commands/logs.ts`

- [ ] **Step 1: Create `src/cli/commands/logs.ts`**

```ts
import chalk from "chalk";
import { getAuditDbPath } from "../../config/paths.js";
import { AuditLogger } from "../../audit/logger.js";
import type { AuditQueryFilters } from "../../audit/types.js";

function parseDuration(duration: string): Date {
  const match = duration.match(/^(\d+)(h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration: ${duration} (use formats like 24h, 7d)`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms = unit === "h" ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

export async function logsCommand(options: {
  agent?: string;
  last?: string;
  decision?: string;
  limit?: string;
}): Promise<void> {
  const audit = new AuditLogger(getAuditDbPath());

  const filters: AuditQueryFilters = {};
  if (options.agent) filters.agentType = options.agent;
  if (options.last) filters.since = parseDuration(options.last);
  if (options.decision) {
    if (!["allow", "deny", "require_approval"].includes(options.decision)) {
      console.error(chalk.red(`Invalid decision: ${options.decision}`));
      process.exit(1);
    }
    filters.decision = options.decision as "allow" | "deny" | "require_approval";
  }
  filters.limit = options.limit ? parseInt(options.limit, 10) : 50;

  const entries = audit.query(filters);

  if (entries.length === 0) {
    console.log(chalk.yellow("No audit entries match the filters."));
    audit.close();
    return;
  }

  for (const entry of entries) {
    const ts = entry.timestamp.toISOString().replace("T", " ").slice(0, 19);
    const color =
      entry.decision === "allow"
        ? chalk.green
        : entry.decision === "deny"
        ? chalk.red
        : chalk.yellow;
    const decisionTag = color(`[${entry.decision.toUpperCase()}]`);
    const cost = entry.cost !== null ? `$${entry.cost.toFixed(4)}` : "-";
    console.log(
      `${chalk.gray(ts)}  ${decisionTag}  ${chalk.cyan(entry.agentType)}  ${entry.tool}  ${chalk.gray(cost)}`
    );
    if (entry.reason) {
      console.log(`  ${chalk.gray(entry.reason)}`);
    }
  }

  console.log(chalk.gray(`\n${entries.length} entries`));
  audit.close();
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/cli/commands/logs.ts
git commit -m "feat(cli): add logs command with filters and colored output"
```

---

## Task 22: Wire CLI Entrypoint + End-to-End Smoke Test

**Files:**
- Modify: `packages/core/src/cli/index.ts`
- Create: `packages/core/tests/e2e/cli-smoke.test.ts`

- [ ] **Step 1: Replace `src/cli/index.ts` with working commands**

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { logsCommand } from "./commands/logs.js";
import { agentAddCommand, agentListCommand } from "./commands/agent.js";

const program = new Command();

program
  .name("agentguard")
  .description("MCP middleware proxy for AI agent safety")
  .version("0.1.0");

program
  .command("init")
  .description("Create default config at ~/.agentguard/config.yaml")
  .option("--force", "overwrite existing files")
  .action(initCommand);

program
  .command("start")
  .description("Start MCP proxy server (stdio)")
  .action(startCommand);

program
  .command("logs")
  .description("Query audit logs")
  .option("--agent <name>", "Filter by agent name")
  .option("--last <duration>", "Show logs from last duration (e.g., 24h, 7d)")
  .option("--decision <type>", "Filter by decision (allow, deny, require_approval)")
  .option("--limit <n>", "Max entries to show", "50")
  .action(logsCommand);

const agentCmd = program.command("agent").description("Manage agent registrations");

agentCmd
  .command("add")
  .description("Register a new agent type")
  .requiredOption("--name <name>", "Agent name")
  .option("--budget-daily <amount>", "Daily budget in USD", parseFloat)
  .option("--budget-per-session <amount>", "Per-session budget in USD", parseFloat)
  .option("--from <baseAgent>", "Create as variant of existing agent")
  .action(agentAddCommand);

agentCmd
  .command("list")
  .description("List registered agents")
  .action(agentListCommand);

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Write an end-to-end smoke test**

Create `packages/core/tests/e2e/cli-smoke.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = "node dist/cli/index.js";

describe("CLI smoke", () => {
  let homeDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "agentguard-home-"));
    env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("init creates config files", () => {
    execSync(`${CLI} init`, { env, cwd: "." });
    expect(existsSync(join(homeDir, ".agentguard", "config.yaml"))).toBe(true);
    expect(existsSync(join(homeDir, ".agentguard", "agents.yaml"))).toBe(true);
  });

  it("agent add then list shows the agent", () => {
    execSync(`${CLI} init`, { env });
    execSync(`${CLI} agent add --name openclaw --budget-daily 30`, { env });
    const output = execSync(`${CLI} agent list`, { env }).toString();
    expect(output).toContain("openclaw");
    expect(output).toContain("$30/day");
  });

  it("logs with no entries shows empty message", () => {
    execSync(`${CLI} init`, { env });
    const output = execSync(`${CLI} logs`, { env }).toString();
    expect(output.toLowerCase()).toContain("no audit");
  });
});
```

- [ ] **Step 3: Build the package**

Run: `cd packages/core && pnpm build`
Expected: TypeScript compiles without errors.

- [ ] **Step 4: Run the smoke test**

Run: `cd packages/core && pnpm test tests/e2e/cli-smoke.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Run the full test suite**

Run: `cd packages/core && pnpm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/cli/index.ts packages/core/tests/e2e/cli-smoke.test.ts
git commit -m "feat(cli): wire commander entrypoint with all subcommands + e2e smoke test"
```

- [ ] **Step 7: Final push**

```bash
git push
```

---

## Completion Criteria

Phase 1 is complete when:

1. All 22 tasks committed
2. `pnpm test` passes with 60+ tests across all modules
3. `pnpm build` produces a working CLI at `dist/cli/index.js`
4. `agentguard init` creates config files
5. `agentguard agent add --name openclaw --budget-daily 30` registers an agent
6. `agentguard agent list` displays registered agents
7. `agentguard start` starts an MCP stdio server that accepts tool call requests
8. When an agent calls a tool via the proxy, the decision is logged to `~/.agentguard/audit.db`
9. `agentguard logs` displays audit entries with filters

After Phase 1, you have a functional minimum viable product:
- Agents can connect through AgentGuard
- Policy decisions are enforced (allow/deny)
- Budgets are enforced as hard boundaries
- All decisions are logged and queryable
- Agent identity and instance tracking work

**Phase 2** (not in this plan) will add: actual downstream MCP forwarding, threat feed, registry integration, learning mode, approval queue, and the local web dashboard.
