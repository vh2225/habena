import { describe, it, expect } from "vitest";
import { buildAuthUrl, extractAuthCode } from "../../src/downstream-add/google-oauth.js";

describe("buildAuthUrl", () => {
  const client = { client_id: "abc.apps.googleusercontent.com", client_secret: "secret-xyz" };

  it("includes client_id and scopes", () => {
    const url = new URL(buildAuthUrl(client, ["https://www.googleapis.com/auth/gmail.modify"]));
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(client.client_id);
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.modify");
  });

  it("requests offline access + consent prompt so we get a refresh_token", () => {
    const url = new URL(buildAuthUrl(client, ["scope-a"]));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("joins multiple scopes with spaces", () => {
    const url = new URL(buildAuthUrl(client, ["scope-a", "scope-b", "scope-c"]));
    expect(url.searchParams.get("scope")).toBe("scope-a scope-b scope-c");
  });
});

describe("extractAuthCode", () => {
  const REAL_CODE = "4/0AciIabc123def456ghi789jklmno";

  it("handles a full callback URL", () => {
    const url = `http://localhost:3847/callback?iss=https://accounts.google.com&code=${REAL_CODE}&scope=email profile`;
    expect(extractAuthCode(url)).toBe(REAL_CODE);
  });

  it("handles just the query string fragment", () => {
    expect(extractAuthCode(`?code=${REAL_CODE}&scope=email`)).toBe(REAL_CODE);
  });

  it("handles a bare Google-shaped code", () => {
    expect(extractAuthCode(REAL_CODE)).toBe(REAL_CODE);
  });

  it("trims whitespace around a bare code", () => {
    expect(extractAuthCode(`   ${REAL_CODE}   `)).toBe(REAL_CODE);
  });

  it("returns null for obvious junk", () => {
    expect(extractAuthCode("hello")).toBe(null);
    expect(extractAuthCode("")).toBe(null);
  });

  it("rejects path-shaped strings that are not Google auth codes (security: M3)", () => {
    // Old regex `^[A-Za-z0-9_\-/]{10,}$` would have matched these and
    // POSTed them to Google. New regex requires the `4/` Google prefix.
    expect(extractAuthCode("/etc/passwd/foo")).toBe(null);
    expect(extractAuthCode("../../../bin/sh")).toBe(null);
    expect(extractAuthCode("some-long-opaque-string-without-prefix")).toBe(null);
  });
});
