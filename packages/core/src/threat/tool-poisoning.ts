import type { Finding } from "./types.js";

interface Signature {
  id: string;
  re: RegExp;
  severity: Finding["severity"];
  message: string;
}

const SIGNATURES: Signature[] = [
  { id: "injection", re: /\b(?:ignore|disregard|forget)\b[^.]{0,40}\b(?:previous|prior|earlier|above|all)\b[^.]{0,20}\b(?:instructions?|prompts?|rules?)\b/i, severity: "high", message: "instruction-injection phrasing in tool description" },
  { id: "conceal", re: /\bdo not (?:tell|inform|mention|reveal|disclose)[^.]{0,30}\b(?:the )?user\b/i, severity: "high", message: "tool description instructs the agent to hide activity from the user" },
  { id: "exfil_secret", re: /\b(?:read|open|cat|exfiltrate|leak|send|upload|post)\b[^.]{0,40}(?:~\/\.ssh|id_rsa|\.env\b|secret|credential|password|private key)/i, severity: "critical", message: "tool description references reading/exfiltrating secrets" },
  { id: "exfil_dest", re: /\b(?:send|forward|post|upload|exfiltrate|email|bcc)\b[^.]{0,40}(?:to\s+)?(?:https?:\/\/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i, severity: "high", message: "tool description instructs sending data to an external destination" },
  { id: "hidden_block", re: /<(?:important|system|secret|instructions?)>/i, severity: "medium", message: "hidden-instruction block in tool description" },
  // Zero-width / bidi control chars: U+200B-200F, U+202A-202E, U+2060, U+FEFF.
  { id: "zero_width", re: /[​-‏‪-‮⁠﻿]/, severity: "medium", message: "zero-width / bidi control characters in tool description" },
];

/** Pure: scan a tool description for poisoning cues. Never throws. */
export function detectToolPoisoning(description: string | undefined): Finding[] {
  if (!description) return [];
  const findings: Finding[] = [];
  for (const sig of SIGNATURES) {
    if (sig.re.test(description)) {
      findings.push({ detector: "tool_poisoning", severity: sig.severity, message: sig.message, evidence: `match:${sig.id}` });
    }
  }
  return findings;
}
