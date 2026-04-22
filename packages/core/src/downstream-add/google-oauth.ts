import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Minimal Google OAuth 2.0 code-for-token exchange. We don't pull in
 * googleapis just for this — the OAuth dance is a few fetches and a URL
 * construction. Saves a big dep for a narrow use case.
 */

export interface GoogleOAuthClient {
  client_id: string;
  client_secret: string;
}

export interface GoogleToken {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export function buildAuthUrl(
  client: GoogleOAuthClient,
  scopes: string[],
  redirectUri = "http://localhost:3847/callback"
): string {
  const params = new URLSearchParams({
    access_type: "offline",
    scope: scopes.join(" "),
    prompt: "consent",
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * The user pastes back either the full callback URL or just the `code=...`
 * value. Extract just the code string either way.
 */
export function extractAuthCode(input: string): string | null {
  const trimmed = input.trim();
  // Full URL
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (code) return code;
  } catch {
    // not a URL — fall through
  }
  // ?code=...&scope=... fragment
  const m = trimmed.match(/code=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  // Bare code (usually starts with `4/0`)
  if (/^[A-Za-z0-9_\-/]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export async function exchangeCodeForToken(
  client: GoogleOAuthClient,
  code: string,
  redirectUri = "http://localhost:3847/callback"
): Promise<GoogleToken> {
  const body = new URLSearchParams({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Token exchange failed (${r.status}): ${text.slice(0, 300)}`);
  }
  const json = (await r.json()) as Record<string, unknown>;
  const token: GoogleToken = {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token as string | undefined,
    token_type: json.token_type as string | undefined,
    scope: json.scope as string | undefined,
    id_token: json.id_token as string | undefined,
  };
  if (typeof json.expires_in === "number") {
    token.expiry_date = Date.now() + Number(json.expires_in) * 1000;
  }
  return token;
}

/**
 * Save the OAuth client credentials + token to disk at the paths the
 * antidrift-mcp-gmail MCP server expects.
 */
export function saveAntidriftCredentials(
  client: GoogleOAuthClient,
  token: GoogleToken,
  credsDir: string
): { clientPath: string; tokenPath: string } {
  mkdirSync(credsDir, { recursive: true, mode: 0o700 });
  const clientPath = `${credsDir}/client.json`;
  const tokenPath = `${credsDir}/token.json`;
  writeFileSync(clientPath, JSON.stringify(client, null, 2), { mode: 0o600 });
  writeFileSync(tokenPath, JSON.stringify(token, null, 2), { mode: 0o600 });
  return { clientPath, tokenPath };
}

export function loadExistingClient(credsDir: string): GoogleOAuthClient | null {
  const clientPath = `${credsDir}/client.json`;
  if (!existsSync(clientPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(clientPath, "utf8"));
    // Accept both the flat shape we write and Google's downloaded
    // {installed: {client_id, ...}} shape.
    if (raw.installed?.client_id) return raw.installed;
    if (raw.client_id) return raw;
    return null;
  } catch {
    return null;
  }
}

/** Ensure parent dir exists before writing — convenience for callers. */
export function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
}
