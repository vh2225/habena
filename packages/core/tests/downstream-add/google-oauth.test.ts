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
  it("handles a full callback URL", () => {
    const url = "http://localhost:3847/callback?iss=https://accounts.google.com&code=4/0Aci98E-abc123&scope=email profile";
    expect(extractAuthCode(url)).toBe("4/0Aci98E-abc123");
  });

  it("handles just the query string fragment", () => {
    expect(extractAuthCode("?code=4/0Aci98E-abc123&scope=email")).toBe("4/0Aci98E-abc123");
  });

  it("handles a bare code", () => {
    expect(extractAuthCode("4/0Aci98E-abc123_xyz")).toBe("4/0Aci98E-abc123_xyz");
  });

  it("trims whitespace", () => {
    expect(extractAuthCode("   4/0Aci98E-abc123_xyz   ")).toBe("4/0Aci98E-abc123_xyz");
  });

  it("returns null for obvious junk", () => {
    expect(extractAuthCode("hello")).toBe(null);
    expect(extractAuthCode("")).toBe(null);
  });
});
