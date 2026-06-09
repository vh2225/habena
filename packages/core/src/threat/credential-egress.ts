import type { Finding } from "./types.js";

interface Signature {
  id: string;
  re: RegExp;
  severity: Finding["severity"];
  message: string;
}

// Specific-first. Each regex targets a recognizable secret SHAPE so benign text
// (paths, prose, git shas) doesn't trip it. Token lengths are upper-bounded so an
// arbitrarily long alphanumeric blob can't masquerade as a token.
const SIGNATURES: Signature[] = [
  { id: "pem", re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/, severity: "critical", message: "private key material in arguments" },
  { id: "aws", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, severity: "high", message: "AWS access key in arguments" },
  { id: "gh", re: /\bgh[pousr]_[A-Za-z0-9]{36,251}\b/, severity: "high", message: "GitHub token in arguments" },
  { id: "slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,255}\b/, severity: "high", message: "Slack token in arguments" },
  { id: "ssh_path", re: /(?:\/|^|~\/)\.ssh\/id_(?:rsa|ed25519|ecdsa|dsa)\b/, severity: "high", message: ".ssh private key path in arguments" },
  { id: "google_api", re: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: "high", message: "Google API key in arguments" },
];

// Bounds — adversarial args are the threat model, so the walk must not exhaust the
// stack or CPU. Real tool-call args are tiny; these limits only bite on hostile input.
const MAX_DEPTH = 200;
const MAX_LEAVES = 20_000;
const MAX_TOTAL_CHARS = 2_000_000;

interface WalkResult {
  leaves: string[];
  /** True if a limit (depth/leaf-count/char-budget) cut the walk short. */
  truncated: boolean;
}

/** Iterative, bounded walk of all string leaves. No recursion → no stack overflow. */
function collectStrings(root: unknown): WalkResult {
  const leaves: string[] = [];
  let totalChars = 0;
  let truncated = false;
  const stack: Array<{ v: unknown; depth: number }> = [{ v: root, depth: 0 }];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.depth > MAX_DEPTH) { truncated = true; continue; }
    const v = node.v;
    if (typeof v === "string") {
      if (leaves.length >= MAX_LEAVES || totalChars >= MAX_TOTAL_CHARS) { truncated = true; continue; }
      leaves.push(v);
      totalChars += v.length;
    } else if (Array.isArray(v)) {
      for (const x of v) stack.push({ v: x, depth: node.depth + 1 });
    } else if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) stack.push({ v: x, depth: node.depth + 1 });
    }
  }
  return { leaves, truncated };
}

/**
 * Pure: scan call args for secrets being passed outbound. Never throws and never
 * fails open — unscannable/pathological input yields a finding, not silence.
 * `evidence` is a redacted label and NEVER the matched secret.
 */
export function detectCredentialEgress(args: Record<string, unknown>): Finding[] {
  let result: WalkResult;
  try {
    result = collectStrings(args);
  } catch {
    return [{ detector: "credential_egress", severity: "medium", message: "arguments could not be scanned for secrets", evidence: "unscannable" }];
  }
  const findings: Finding[] = [];
  for (const sig of SIGNATURES) {
    if (result.leaves.some((leaf) => sig.re.test(leaf))) {
      findings.push({ detector: "credential_egress", severity: sig.severity, message: sig.message, evidence: `match:${sig.id}` });
    }
  }
  if (result.truncated) {
    findings.push({ detector: "credential_egress", severity: "medium", message: "arguments too large/deeply nested to fully scan for secrets", evidence: "truncated" });
  }
  return findings;
}
