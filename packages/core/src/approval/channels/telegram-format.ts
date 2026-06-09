/**
 * Pure formatting / parsing helpers for the Telegram approval channel.
 *
 * No I/O here — these are the well-tested building blocks D3 will compose into
 * the live channel. Helper logic mirrors the proven approval-bridge.mjs
 * reference (parseCb / fmtArgs / promptText).
 */
import type { SerializedPendingApproval } from "../../ipc/protocol.js";

/** The only choices a button tap may ever resolve to. */
export type CallbackChoice = "allow_once" | "deny";

export interface ParsedCallback {
  choice: CallbackChoice;
  token: string;
}

/**
 * Parse Telegram inline-button callback_data of the form
 * `ag:<choice>:<token>` where choice is strictly in the allowlist.
 *
 * SECURITY: this is the trust boundary for button taps. The anchored,
 * case-sensitive regex with an explicit choice allowlist guarantees we never
 * return a choice outside {allow_once, deny}, and never return an empty token.
 */
export function parseCallback(data: string): ParsedCallback | null {
  const m = /^ag:(allow_once|deny):(.+)$/.exec(data ?? "");
  if (!m) return null;
  return { choice: m[1] as CallbackChoice, token: m[2] };
}

/**
 * JSON-stringify args and cap the result at `max` chars, appending an ellipsis
 * when truncated (so a capped result is exactly `max + 1` chars long).
 * Never throws on circular-free objects.
 */
export function truncateArgs(args: Record<string, unknown>, max = 500): string {
  const s = JSON.stringify(args);
  if (s.length > max) return s.slice(0, max) + "…";
  return s;
}

/** Markdown approval message for the owner's chat. */
export function promptText(p: SerializedPendingApproval): string {
  const inst = p.instanceId ? ` / ${p.instanceId}` : "";
  const cost =
    p.estimatedCost > 0
      ? `*Est. cost:* $${p.estimatedCost.toFixed(4)}\n`
      : "";

  let expires = "";
  try {
    expires = `*Expires:* ${new Date(p.expiresAt).toLocaleTimeString("en-US")}\n`;
  } catch {
    expires = "";
  }

  return (
    `🛡️ *AgentGuard approval*\n\n` +
    `*Tool:* \`${p.tool}\`\n` +
    `*Agent:* ${p.agentType}${inst}\n` +
    `*Why:* ${p.reason}\n` +
    cost +
    expires +
    `\n*Args:*\n\`\`\`\n${truncateArgs(p.args)}\n\`\`\``
  );
}
