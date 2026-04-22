import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { addDownstreamServer, type AddServerOptions, type AddServerResult } from "./installer.js";

export interface AddFilesystemArgs {
  path: string;
  name?: string;
}

export async function addFilesystemServer(
  args: AddFilesystemArgs,
  options: AddServerOptions = {}
): Promise<AddServerResult> {
  const absPath = resolve(args.path);
  if (!existsSync(absPath)) {
    throw new Error(`Directory not found: ${absPath}`);
  }
  const stat = statSync(absPath);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${absPath}`);
  }

  const name = args.name ?? "filesystem";
  return addDownstreamServer(
    name,
    {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", absPath],
      auth_probe: { tool: "list_allowed_directories" },
    },
    options
  );
}
