/**
 * Agent process fingerprinting.
 * Verifies that a connecting agent is who it claims to be
 * by checking process metadata and binary hash.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface ProcessFingerprint {
  pid: number;
  binaryPath: string;
  binaryHash: string;
  parentPid: number;
  mcpClientName?: string;
  mcpClientVersion?: string;
}

export async function fingerprint(pid: number): Promise<ProcessFingerprint> {
  // TODO: Read /proc/{pid} or use process info APIs on macOS
  // TODO: Hash the binary at the process path
  throw new Error("Not implemented");
}

export async function hashBinary(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

export function matchesKnown(
  observed: ProcessFingerprint,
  expected: { fingerprint: string; binaryPath?: string }
): "match" | "mismatch" | "new" {
  // TODO: Compare observed process against known agent registration
  throw new Error("Not implemented");
}
