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

export interface InlineButton {
  text: string;
  callback_data: string;
}
export type InlineKeyboard = InlineButton[][];

/**
 * Build the inline keyboard for an approval prompt.
 *
 * SECURITY (Task 8, two-channel confirmation): an approval whose run was
 * commanded FROM Telegram (`origin === "telegram"`) must never be allowable
 * FROM Telegram — a stolen phone could otherwise both command a risky action
 * and approve it. For those approvals this keyboard omits the Allow button
 * entirely; only Deny is offered here. (Defense in depth: `telegram.ts` also
 * refuses to act on a forged/replayed allow_once tap for such an approval,
 * even if a client fabricates the callback_data without a real button.)
 */
export function buildKeyboard(
  p: SerializedPendingApproval,
  token: string
): InlineKeyboard {
  const deny: InlineButton = { text: "⛔ Deny", callback_data: `ag:deny:${token}` };
  if (p.origin === "telegram") {
    return [[deny]];
  }
  const allow: InlineButton = {
    text: "✅ Allow once",
    callback_data: `ag:allow_once:${token}`,
  };
  return [[allow, deny]];
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

  // SECURITY (Task 8): make the two-channel rule visible in the chat itself —
  // a Telegram-originated run is deny-only from here; the owner must switch
  // to the Mac dashboard to actually allow it.
  const macNotice =
    p.origin === "telegram"
      ? `\n\n⚠️ Requested from Telegram — approve from your Mac dashboard.`
      : "";

  return (
    `🛡️ *Habena approval*\n\n` +
    `*Tool:* \`${p.tool}\`\n` +
    `*Agent:* ${p.agentType}${inst}\n` +
    `*Why:* ${p.reason}\n` +
    cost +
    expires +
    `\n*Args:*\n\`\`\`\n${truncateArgs(p.args)}\n\`\`\`` +
    macNotice
  );
}
