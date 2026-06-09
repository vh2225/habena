import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { configDir } from "./config-dir";
import type { PolicyView, RuleView, BudgetView, ApprovalView, DownstreamView } from "./policy";

function emptyView(): PolicyView {
  return { configured: false, budget: null, rules: [], extendsPacks: [], approval: null, downstreams: [] };
}
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Pure: parse config.yaml text → PolicyView. Never throws. Never includes secrets. */
export function parsePolicy(text: string | null): PolicyView {
  if (!text) return emptyView();
  let doc: Record<string, unknown> | null = null;
  try {
    const v = parse(text);
    doc = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return emptyView();
  }
  if (!doc) return emptyView();

  const b = doc.budget as Record<string, unknown> | undefined;
  const calls = (b?.calls && typeof b.calls === "object" ? b.calls : {}) as Record<string, unknown>;
  const budget: BudgetView | null = b && typeof b === "object"
    ? {
        daily: num(b.daily), monthly: num(b.monthly), perSession: num(b.per_session), perRequest: num(b.per_request),
        callsPerMinute: num(calls.per_minute), callsPerHour: num(calls.per_hour), callsPerDay: num(calls.per_day),
        onExceed: str(b.on_exceed), alertAt: Array.isArray(b.alert_at) ? (b.alert_at.filter((x): x is number => typeof x === "number")) : null,
      }
    : null;

  const rawRules = Array.isArray(doc.rules) ? doc.rules : [];
  const rules: RuleView[] = rawRules.map((r, i) => {
    const rule = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return {
      index: i,
      // `match` is copied verbatim — it holds matching criteria (tool/server/path/
      // arg substrings), which are not secrets. This is the only verbatim-copy path;
      // if rule shapes ever grow to carry sensitive values, whitelist keys here.
      match: (rule.match && typeof rule.match === "object" ? rule.match : {}) as Record<string, unknown>,
      action: str(rule.action) ?? "",
      enforcement: str(rule.enforcement),
      reason: str(rule.reason),
    };
  });

  const extendsPacks = strArr(doc.extends);

  const ap = doc.approval as Record<string, unknown> | undefined;
  let approval: ApprovalView | null = null;
  if (ap && typeof ap === "object") {
    const rf = ap.require_for as { tools?: unknown; tool_tags?: unknown } | undefined;
    const alwaysRequire = [...strArr(rf?.tools), ...strArr(rf?.tool_tags)];
    const channels = ap.channels && typeof ap.channels === "object" ? Object.keys(ap.channels as Record<string, unknown>) : [];
    approval = { timeoutAction: str(ap.timeout_action), alwaysRequire, channels };
  }

  const ms = doc.mcp_servers as Record<string, unknown> | undefined;
  const downstreams: DownstreamView[] = ms && typeof ms === "object"
    ? Object.entries(ms).map(([name, v]) => ({ name, command: str((v as Record<string, unknown> | null)?.command) }))
    : [];

  return { configured: true, budget, rules, extendsPacks, approval, downstreams };
}

/** SERVER-ONLY IO: read config.yaml from the config dir. */
export function readPolicy(): PolicyView {
  const p = join(configDir(), "config.yaml");
  try {
    return parsePolicy(existsSync(p) ? readFileSync(p, "utf8") : null);
  } catch {
    return emptyView();
  }
}
