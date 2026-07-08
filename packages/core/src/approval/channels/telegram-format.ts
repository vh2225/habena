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

/** Escape the three HTML-significant characters for Telegram HTML parse mode. */
export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// Slot sentinel for the stash/unstash pass below. A private-use codepoint:
// it can never appear in real chat text, and (unlike a NUL byte) keeps this
// file plain text for git/diff tooling.
const SLOT = "\uE000";

// Inline markdown -> Telegram HTML for a single line.
function inline(text: string): string {
  const slots: string[] = [];
  const stash = (h: string): string => `${SLOT}${slots.push(h) - 1}${SLOT}`;

  let s = String(text ?? "");
  // Protect code spans and links BEFORE escaping/emphasis so their contents
  // (which may contain <, &, *, _) are never reinterpreted.
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => stash(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
    stash(`<a href="${escapeAttr(url)}">${escapeHtml(label)}</a>`)
  );

  s = escapeHtml(s);

  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/__([^_]+)__/g, "<b>$1</b>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/\*([^*\n]+)\*/g, "<i>$1</i>");
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1<i>$2</i>");

  s = s.replace(new RegExp(`${SLOT}(\\d+)${SLOT}`, "g"), (_m, i: string) => slots[Number(i)]);
  return s;
}

/**
 * Convert the markdown our approval messages use into Telegram-safe HTML.
 *
 * Telegram's legacy "Markdown" parse mode only renders `*single*`/`` `code` ``
 * and 400s on stray punctuation; HTML is robust (only & < > need escaping) and
 * renders `**bold**`, `## headers`, `- bullets`, and `[links](url)`. Emphasis
 * follows standard markdown: `**`/`__` = bold, `*`/`_` = italic. Plain text is
 * simply escaped, so non-markdown command replies pass through safely.
 */
export function markdownToHtml(md: string | null | undefined): string {
  if (md == null) return "";
  const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let quote: string[] = [];
  const flushQuote = (): void => {
    if (quote.length) {
      out.push(`<blockquote>${quote.join("\n")}</blockquote>`);
      quote = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushQuote();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      const code = escapeHtml(body.join("\n"));
      const lang = fence[1];
      out.push(lang ? `<pre><code class="language-${lang}">${code}</code></pre>` : `<pre>${code}</pre>`);
      continue;
    }

    const q = line.match(/^>\s?(.*)$/);
    if (q) { quote.push(inline(q[1])); continue; }
    flushQuote();

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push("──────────"); continue; }

    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { out.push(`<b>${inline(h[2])}</b>`); continue; }

    const b = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (b) { out.push(`${b[1]}• ${inline(b[2])}`); continue; }

    const n = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (n) { out.push(`${n[1]}${n[2]}. ${inline(n[3])}`); continue; }

    out.push(inline(line));
  }
  flushQuote();
  return out.join("\n");
}

/**
 * Markdown approval message for the owner's chat (rendered to HTML by
 * TelegramApi at send time). `**` markers so labels stay bold under
 * standard-markdown emphasis rules.
 */
export function promptText(p: SerializedPendingApproval): string {
  const inst = p.instanceId ? ` / ${p.instanceId}` : "";
  const cost =
    p.estimatedCost > 0
      ? `**Est. cost:** $${p.estimatedCost.toFixed(4)}\n`
      : "";

  let expires = "";
  try {
    expires = `**Expires:** ${new Date(p.expiresAt).toLocaleTimeString("en-US")}\n`;
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
    `🛡️ **Habena approval**\n\n` +
    `**Tool:** \`${p.tool}\`\n` +
    `**Agent:** ${p.agentType}${inst}\n` +
    `**Why:** ${p.reason}\n` +
    cost +
    expires +
    `\n**Args:**\n\`\`\`\n${truncateArgs(p.args)}\n\`\`\`` +
    macNotice
  );
}
