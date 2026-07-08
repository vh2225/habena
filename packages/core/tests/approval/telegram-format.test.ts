import { describe, it, expect } from "vitest";
import {
  parseCallback,
  truncateArgs,
  promptText,
  buildKeyboard,
  escapeHtml,
  markdownToHtml,
} from "../../src/approval/channels/telegram-format.js";
import type { SerializedPendingApproval } from "../../src/ipc/protocol.js";

function makePending(
  overrides: Partial<SerializedPendingApproval> = {}
): SerializedPendingApproval {
  return {
    id: "appr-1",
    agentType: "wp-editor",
    instanceId: "inst-7",
    tool: "wordpress_delete_post",
    args: { postId: 42, force: true },
    reason: "destructive WordPress edit",
    estimatedCost: 0,
    createdAt: "2026-06-08T10:00:00.000Z",
    expiresAt: "2026-06-08T10:05:00.000Z",
    ...overrides,
  };
}

describe("parseCallback", () => {
  it("parses allow_once with a token", () => {
    expect(parseCallback("ag:allow_once:abc")).toEqual({
      choice: "allow_once",
      token: "abc",
    });
  });

  it("parses deny with a token", () => {
    expect(parseCallback("ag:deny:xyz")).toEqual({
      choice: "deny",
      token: "xyz",
    });
  });

  it("allows tokens containing colons (greedy tail)", () => {
    expect(parseCallback("ag:deny:a:b:c")).toEqual({
      choice: "deny",
      token: "a:b:c",
    });
  });

  // SECURITY: only the allowlisted choices may ever come back.
  it("rejects a choice outside the allowlist (allow_session)", () => {
    expect(parseCallback("ag:allow_session:x")).toBeNull();
  });

  it("rejects an empty token", () => {
    expect(parseCallback("ag:deny:")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(parseCallback("")).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseCallback("garbage")).toBeNull();
  });

  it("is case-sensitive (ag:DENY:x rejected)", () => {
    expect(parseCallback("ag:DENY:x")).toBeNull();
  });

  it("rejects a missing prefix", () => {
    expect(parseCallback("allow_once:abc")).toBeNull();
  });

  it("rejects extra leading characters before the prefix", () => {
    expect(parseCallback("xag:deny:abc")).toBeNull();
  });
});

describe("truncateArgs", () => {
  it("passes small args through as JSON", () => {
    const out = truncateArgs({ a: 1, b: "two" });
    expect(out).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("caps huge args at max+1 chars (ellipsis)", () => {
    const big = { blob: "x".repeat(5000) };
    const out = truncateArgs(big, 500);
    expect(out.length).toBe(501);
    expect(out.endsWith("…")).toBe(true);
  });

  it("respects a custom max", () => {
    const big = { blob: "x".repeat(5000) };
    const out = truncateArgs(big, 50);
    expect(out.length).toBe(51);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not truncate when exactly at max", () => {
    // Build args whose JSON is exactly `max` chars long.
    const filler = "y".repeat(490);
    const obj = { blob: filler };
    const json = JSON.stringify(obj);
    const out = truncateArgs(obj, json.length);
    expect(out).toBe(json);
    expect(out.endsWith("…")).toBe(false);
  });

  it("does not throw on a normal object", () => {
    expect(() => truncateArgs({ nested: { x: [1, 2, 3] } })).not.toThrow();
  });
});

describe("promptText", () => {
  it("includes the tool name", () => {
    const text = promptText(makePending());
    expect(text).toContain("wordpress_delete_post");
  });

  it("includes the agent type", () => {
    const text = promptText(makePending());
    expect(text).toContain("wp-editor");
  });

  it("includes the reason", () => {
    const text = promptText(makePending({ reason: "needs human eyes" }));
    expect(text).toContain("needs human eyes");
  });

  it("truncates long args via truncateArgs", () => {
    const big = { blob: "z".repeat(5000) };
    const text = promptText(makePending({ args: big }));
    // The full 5000-char blob must NOT appear verbatim.
    expect(text).not.toContain("z".repeat(5000));
    // The truncation ellipsis from truncateArgs is present.
    expect(text).toContain("…");
  });

  it("includes an expiry hint", () => {
    const text = promptText(makePending());
    expect(text.toLowerCase()).toContain("expire");
  });

  // SECURITY (Task 8): two-channel confirmation — a run commanded from the
  // phone must be approved from the Mac, never from the phone itself.
  it("does not add a Mac notice for non-telegram-origin approvals", () => {
    const text = promptText(makePending({ origin: "web" }));
    expect(text).not.toMatch(/approve from your Mac/i);
  });

  it("appends a Mac-approval notice for telegram-origin approvals", () => {
    const text = promptText(makePending({ origin: "telegram" }));
    expect(text).toMatch(/approve from your Mac/i);
  });
});

describe("buildKeyboard", () => {
  it("renders allow + deny buttons sharing one token for non-telegram-origin approvals", () => {
    const kb = buildKeyboard(makePending({ origin: "web" }), "token1");
    const labels = kb.flat().map((b) => b.text);
    expect(labels.join(" ")).toMatch(/allow/i);
    expect(labels.join(" ")).toMatch(/deny/i);
    const data = kb.flat().map((b) => b.callback_data);
    expect(data).toContain("ag:allow_once:token1");
    expect(data).toContain("ag:deny:token1");
  });

  it("also renders allow + deny buttons when origin is unset (undefined != telegram)", () => {
    const kb = buildKeyboard(makePending(), "token1");
    const labels = kb.flat().map((b) => b.text);
    expect(labels.join(" ")).toMatch(/allow/i);
  });

  // SECURITY (Task 8): a stolen phone can command a run but must not be able
  // to also allow its own approval — deny-only keyboard for telegram origin.
  it("renders a deny-only keyboard for telegram-origin approvals", () => {
    const kb = buildKeyboard(makePending({ origin: "telegram" }), "token1");
    const labels = kb.flat().map((b) => b.text);
    expect(labels.join(" ")).not.toMatch(/allow/i);
    expect(labels.join(" ")).toMatch(/deny/i);
    const data = kb.flat().map((b) => b.callback_data);
    expect(data).not.toContain("ag:allow_once:token1");
    expect(data).toContain("ag:deny:token1");
  });
});

describe("escapeHtml", () => {
  it("escapes the three HTML-significant chars, & first", () => {
    expect(escapeHtml("<&>")).toBe("&lt;&amp;&gt;");
    expect(escapeHtml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
});

describe("markdownToHtml", () => {
  it("converts bold, italic, and strikethrough", () => {
    expect(markdownToHtml("**b**")).toBe("<b>b</b>");
    expect(markdownToHtml("__b__")).toBe("<b>b</b>");
    expect(markdownToHtml("*i*")).toBe("<i>i</i>");
    expect(markdownToHtml("_i_")).toBe("<i>i</i>");
    expect(markdownToHtml("~~s~~")).toBe("<s>s</s>");
  });

  it("wraps inline code and escapes its contents without applying markdown inside", () => {
    expect(markdownToHtml("`a<b>**x**`")).toBe("<code>a&lt;b&gt;**x**</code>");
  });

  it("renders links, preserving underscores in the URL", () => {
    expect(markdownToHtml("[G](https://g.com/a_b)")).toBe(
      '<a href="https://g.com/a_b">G</a>'
    );
  });

  it("renders headers as bold and bullets as glyphs", () => {
    expect(markdownToHtml("## Title")).toBe("<b>Title</b>");
    expect(markdownToHtml("- a\n- b")).toBe("• a\n• b");
  });

  it("escapes plain ampersands and does not collide a bare number with a slot", () => {
    expect(markdownToHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
    expect(markdownToHtml("see `x` on line 5 now")).toBe(
      "see <code>x</code> on line 5 now"
    );
  });

  it("converts fenced code blocks, escaping contents", () => {
    expect(markdownToHtml("```\nx<1 && y\n```")).toBe("<pre>x&lt;1 &amp;&amp; y</pre>");
    expect(markdownToHtml("```js\nfoo()\n```")).toBe(
      '<pre><code class="language-js">foo()</code></pre>'
    );
  });

  it("returns empty string for nullish input", () => {
    expect(markdownToHtml(null)).toBe("");
    expect(markdownToHtml(undefined)).toBe("");
    expect(markdownToHtml("")).toBe("");
  });

  it("renders promptText labels as bold and its args fence as pre (integration)", () => {
    const html = markdownToHtml(promptText(makePending({ origin: "telegram" })));
    expect(html).toContain("<b>Tool:</b>");
    expect(html).toContain("<b>Habena approval</b>");
    expect(html).toContain("<pre>");
    expect(html).toContain("approve from your Mac dashboard");
    expect(html).not.toContain("**");
  });
});
