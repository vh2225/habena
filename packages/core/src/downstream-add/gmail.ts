import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  saveAntidriftCredentials,
  loadExistingClient,
  extractAuthCode,
  type GoogleOAuthClient,
} from "./google-oauth.js";
import { addDownstreamServer, type AddServerOptions, type AddServerResult } from "./installer.js";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const CREDS_DIR = join(homedir(), ".antidrift", "credentials", "google");

/**
 * Callback interface the CLI passes in for user interaction. Lets us keep
 * the OAuth flow testable and unit-coverable (mock the prompter).
 */
export interface Prompter {
  /** Called when we need the user to open a URL and paste the code back. */
  getAuthCode(authUrl: string): Promise<string>;
  /** Called when client_id and client_secret aren't already on disk. */
  getClientCredentials?(): Promise<GoogleOAuthClient>;
  /** Called to ask whether to proceed with global npm install. */
  confirmNpmInstall?(pkg: string): Promise<boolean>;
}

export interface AddGmailArgs {
  name?: string;
  clientId?: string;
  clientSecret?: string;
  skipInstall?: boolean;
}

export interface AddGmailResult extends AddServerResult {
  clientPath: string;
  tokenPath: string;
  scopesGranted: string;
}

export async function addGmailServer(
  args: AddGmailArgs,
  prompter: Prompter,
  options: AddServerOptions = {}
): Promise<AddGmailResult> {
  // 1. Resolve OAuth client credentials (flags > existing file > prompt)
  let client: GoogleOAuthClient | null = null;
  if (args.clientId && args.clientSecret) {
    client = { client_id: args.clientId, client_secret: args.clientSecret };
  } else {
    client = loadExistingClient(CREDS_DIR);
    if (!client) {
      if (!prompter.getClientCredentials) {
        throw new Error(
          "No OAuth client on disk and no prompter.getClientCredentials provided. Pass --client-id and --client-secret."
        );
      }
      client = await prompter.getClientCredentials();
    }
  }

  // 2. Generate the auth URL + ask the user to complete the flow
  const authUrl = buildAuthUrl(client, GMAIL_SCOPES);
  const codeInput = await prompter.getAuthCode(authUrl);
  const code = extractAuthCode(codeInput);
  if (!code) {
    throw new Error("Couldn't extract an auth code from the pasted value.");
  }

  // 3. Exchange the code for tokens
  const token = await exchangeCodeForToken(client, code);
  if (!token.refresh_token) {
    throw new Error(
      "Google returned no refresh_token — re-authorize with `prompt=consent` (our URL sets this; maybe you reused an old code?)."
    );
  }

  // 4. Save credentials at the path antidrift-mcp-gmail expects
  const paths = saveAntidriftCredentials(client, token, CREDS_DIR);

  // 5. Make sure the MCP server binary is installed globally (unless skipped)
  if (!args.skipInstall) {
    const pkg = "@antidrift/mcp-gmail";
    if (!isGlobalPackageInstalled(pkg)) {
      const proceed = prompter.confirmNpmInstall
        ? await prompter.confirmNpmInstall(pkg)
        : true;
      if (proceed) {
        execSync(`npm install -g ${pkg}`, { stdio: "pipe" });
      }
    }
  }

  // 6. Resolve the server entrypoint path. When npm installed globally,
  //    the package lives under `<npm-global>/node_modules/<pkg>/server.mjs`.
  const serverPath = resolveServerEntrypoint("@antidrift/mcp-gmail", "server.mjs");

  // 7. Write the config.yaml entry
  const name = args.name ?? "gmail";
  const result = addDownstreamServer(
    name,
    {
      command: "node",
      args: [serverPath],
      auth_probe: { tool: "gmail_list_labels" },
    },
    options
  );

  return {
    ...result,
    clientPath: paths.clientPath,
    tokenPath: paths.tokenPath,
    scopesGranted: token.scope ?? GMAIL_SCOPES.join(" "),
  };
}

function isGlobalPackageInstalled(pkg: string): boolean {
  try {
    const root = execSync("npm root -g", { encoding: "utf8", stdio: "pipe" }).trim();
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    return existsSync(`${root}/${pkg}/package.json`);
  } catch {
    return false;
  }
}

function resolveServerEntrypoint(pkg: string, relative: string): string {
  const root = execSync("npm root -g", { encoding: "utf8", stdio: "pipe" }).trim();
  return `${root}/${pkg}/${relative}`;
}
