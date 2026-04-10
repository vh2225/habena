import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";

export function loadYaml<T = unknown>(path: string): T | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8");
  return parse(content) as T;
}
