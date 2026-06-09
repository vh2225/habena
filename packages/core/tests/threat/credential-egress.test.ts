import { describe, it, expect } from "vitest";
import { detectCredentialEgress } from "../../src/threat/credential-egress.js";

const types = (args: Record<string, unknown>) => detectCredentialEgress(args).map((f) => f.message);

describe("detectCredentialEgress", () => {
  it("flags a PEM private key block", () => {
    const f = detectCredentialEgress({ body: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXkt...\n-----END OPENSSH PRIVATE KEY-----" });
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].severity).toBe("critical");
    expect(JSON.stringify(f)).not.toContain("b3BlbnNzaC1rZXkt");
  });

  it("flags AWS access keys and GitHub/Slack tokens", () => {
    expect(types({ note: "key AKIAIOSFODNN7EXAMPLE" }).length).toBe(1);
    expect(types({ note: "ghp_0123456789abcdef0123456789abcdef0123" }).length).toBe(1);
    expect(types({ note: "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx" }).length).toBe(1);
  });

  it("flags an .ssh/id_rsa path reference", () => {
    expect(detectCredentialEgress({ path: "/home/u/.ssh/id_rsa" }).length).toBeGreaterThan(0);
  });

  it("scans nested args (objects + arrays), not just top-level strings", () => {
    expect(detectCredentialEgress({ payload: { items: ["AKIAIOSFODNN7EXAMPLE"] } }).length).toBe(1);
  });

  it("does NOT flag benign args (low false positives)", () => {
    expect(detectCredentialEgress({ path: "~/workspace/notes.md", query: "list files", limit: 20 })).toEqual([]);
    expect(detectCredentialEgress({ message: "deploy the staging branch please" })).toEqual([]);
    expect(detectCredentialEgress({ sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" })).toEqual([]);
  });

  it("catches a secret nested within the depth limit", () => {
    let v: unknown = "AKIAIOSFODNN7EXAMPLE";
    for (let i = 0; i < 50; i++) v = { x: v };
    expect(detectCredentialEgress({ root: v }).some((f) => f.message.includes("AWS"))).toBe(true);
  });

  it("FAILS CLOSED (flags, never returns clean) on pathologically deep args", () => {
    let v: unknown = "AKIAIOSFODNN7EXAMPLE";
    for (let i = 0; i < 6000; i++) v = { x: v };
    const f = detectCredentialEgress({ root: v });
    expect(f.length).toBeGreaterThan(0); // NOT [] — the old recursive walk overflowed + returned [] (fail-open)
    expect(f.some((x) => x.evidence === "truncated")).toBe(true);
  });
});
