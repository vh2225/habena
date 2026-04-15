# Phase 8 — Policy Presets and Rule Packs Design Spec

**Date:** 2026-04-15
**Status:** Draft
**Depends on:** Phase 1 Core MVP (policy engine shipped), Phase 4 install command (shipped)

## Goal

Give a new AgentGuard user a safe baseline in one command, without having to author rules in YAML. Today, `agentguard init` writes an allow-everything default — the exact opposite of safe. Teams that care about safety will edit the config; teams that don't will leave the default and get no protection. Both paths are bad.

Two layers solve it:

- **Policy presets:** named one-shot policies the user can apply (`agentguard policy preset cautious`). Preset = a full `rules:` block baked into the CLI, plus a host-local override file that's strictly enforced.
- **Rule packs:** composable, per-MCP-server rule fragments users can import into their config (`extends: [rules-packs/filesystem-readonly, rules-packs/github-no-push]`). Covers the common case of "this server should be allowed to do X but never Y" without the user having to know which tool names to match.

## Problem

Phase 1 shipped a policy DSL with `match:` rules and three enforcement levels. Phase 5 lab work exposed that even with the full design doc open, writing a correct rule set takes 30+ min of staring at tool names and checking first-match-wins semantics. That's fine for an author sitting next to the spec; it's a disaster for adoption.

Compounding: today's engine has no concept of a policy that the config *cannot override*. OpenClaw calls this "exec-policy" (see `/usr/local/lib/node_modules/openclaw/docs/tools/exec-approvals.md`), and the rule is: *effective policy = stricter of (config, host-local)*. Without that layer, we have no way to say "the operator of this host disabled outbound-network tool calls, and no `agentguard config set` can undo it." That's exactly the property the product thesis needs — check-and-balance that survives user drift.

## Architecture

```
~/.agentguard/
├── config.yaml          ← user-editable, may extend rule packs
├── host-policy.yaml     ← host-local floor, strictly enforced (preset writes here)
└── rule-packs/          ← shipped + user-authored fragments
    ├── filesystem-readonly.yaml
    ├── filesystem-write-approval.yaml
    ├── github-no-push.yaml
    ├── slack-readonly.yaml
    └── ...

PolicyEngine load order:
  1. Hard boundaries (built-in, unchanged)
  2. Session overrides (runtime, unchanged)
  3. host-policy.yaml     NEW — strict floor
  4. config.yaml rules    (after expanding `extends:`)
  5. Defaults
  6. Implicit deny
```

The only semantic change to the engine: when both (3) and (4) produce a decision for the same match, take the stricter of the two — with ordering `deny > require_approval > allow` and `hard_mandatory > soft_mandatory > advisory`.

## Design

### Presets

Three ship in the binary:

| Preset | Intent | `config.yaml` rules | `host-policy.yaml` floor |
|---|---|---|---|
| `observe` | Log everything, block nothing. Phase 6 lab baseline. | `allow *` | (empty — no floor) |
| `cautious` | Sensible defaults for a trusted solo user. Allow read/list, approve writes, hard-deny destructive. | `read_*: allow`, `list_*: allow`, `write_*: soft_mandatory`, `delete_*: deny (hard)`, `*: require_approval` | `*: delete_*: deny (hard)` |
| `deny-all` | Air-gapped. Everything is denied except explicit allowlist the user adds after. | `*: deny (hard)` | `*: deny (hard)` |

CLI: `agentguard policy preset <name> [--force]`. Without `--force`, refuses to overwrite a non-default config. With `--force`, backs up then writes both files with a matching `applied_preset: <name>@<timestamp>` tag in `meta`.

`agentguard policy preset show <name>` prints what it would write without touching disk — important for the wizard UX and for auditing.

### Rule packs

A rule pack is a YAML file with the same `rules:` shape, plus optional `description:` and `server:` metadata. Example:

```yaml
# rule-packs/filesystem-readonly.yaml
description: Read-only access for @modelcontextprotocol/server-filesystem
server: filesystem
rules:
  - match: { server: filesystem, tool: "read_*" }, action: allow }
  - match: { server: filesystem, tool: "list_*" }, action: allow }
  - match: { server: filesystem, tool: "write_*" }, action: deny, enforcement: hard_mandatory }
  - match: { server: filesystem, tool: "delete_*" }, action: deny, enforcement: hard_mandatory }
```

User imports via `extends:` at the top of `config.yaml`:

```yaml
extends:
  - rule-packs/filesystem-readonly
  - rule-packs/github-no-push

rules:
  # user-specific rules appended after extended packs
  - match: { server: sqlite, tool: "*" }, action: require_approval }
```

Resolution: `extends` entries expand to their `rules:` contents at load time, in listed order, *before* the user's own `rules:` — so user rules take precedence on first-match-wins. Packs ship in `packages/core/rule-packs/` and also resolve from `~/.agentguard/rule-packs/` (user-authored).

### `agentguard policy` subcommands

- `preset <name>` — apply a preset to both files.
- `preset show <name>` — dry-run print.
- `packs list` — show built-in + user-authored packs.
- `packs show <name>` — print the pack's rules.
- `explain <tool-call-json>` — given a JSON tool call, trace which rule matched and why. Critical for `doctor` and debugging.

## V1 scope

- Three presets (`observe`, `cautious`, `deny-all`) with working `policy preset` CLI.
- `host-policy.yaml` loaded by the engine; stricter-of-two merge.
- Four rule packs shipped: `filesystem-readonly`, `filesystem-write-approval`, `github-no-push`, `slack-readonly`.
- `extends:` resolution in config loader.
- `packs list|show` and `policy explain` commands.

## Out of V1

- User-authored rule packs fetched from a registry (like npm for rules). Later — requires trust model.
- Preset composition (`preset cautious + extra-strict-network`). YAGNI for V1.
- GUI preset picker in the web dashboard — defer to Phase 6 dashboard work.

## Open questions

1. Should presets be *semantic* (just a rules blob) or *behavioral* (include default budgets, timeouts, etc.)? Proposal: V1 is just rules. Add other knobs if needed.
2. How do we handle a rule pack that later gets tightened upstream — do users auto-upgrade, or pin a version? Proposal: pin by default, `agentguard policy packs update` is explicit.
3. `deny-all` preset on a lab machine with no allowlist would block OpenClaw entirely at first run — is that the right UX or should we nudge toward `cautious`? Proposal: the CLI prints a warning and a next-step hint: "you will need to allow specific servers before the agent can do anything."

## Success criteria

- New user: `agentguard init && agentguard install openclaw && agentguard policy preset cautious` produces a working setup where the agent can read files but cannot write without approval, with zero config editing.
- Red-team: with `deny-all` applied, the phase-7 5-test lab flow all hits hard-deny decisions.
- No path in `config.yaml` alone can weaken the `host-policy.yaml` floor — verified by a unit test that tries every weakening combination.
