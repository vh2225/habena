import type { Finding } from "./types.js";

interface Signature {
  id: string;
  re: RegExp;
  severity: Finding["severity"];
  message: string;
}

const SIGNATURES: Signature[] = [
  { id: "pem", re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/, severity: "critical", message: "private key material in arguments" },
  { id: "aws", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, severity: "high", message: "AWS access key in arguments" },
  { id: "gh", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, severity: "high", message: "GitHub token in arguments" },
  { id: "slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, severity: "high", message: "Slack token in arguments" },
  { id: "ssh_path", re: /(?:\/|^|~\/)\.ssh\/id_(?:rsa|ed25519|ecdsa|dsa)\b/, severity: "high", message: ".ssh private key path in arguments" },
  { id: "google_api", re: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: "high", message: "Google API key in arguments" },
];

function strings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) strings(x, out);
}

/** Pure: scan call args for secrets being passed outbound. Never throws; evidence is redacted. */
export function detectCredentialEgress(args: Record<string, unknown>): Finding[] {
  const leaves: string[] = [];
  try {
    strings(args, leaves);
  } catch {
    return [];
  }
  const hay = leaves.join("\n");
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const sig of SIGNATURES) {
    if (sig.re.test(hay) && !seen.has(sig.id)) {
      seen.add(sig.id);
      findings.push({ detector: "credential_egress", severity: sig.severity, message: sig.message, evidence: `match:${sig.id}` });
    }
  }
  return findings;
}
