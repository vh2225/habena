#!/usr/bin/env node
/**
 * Launches the Habena dashboard (`next start`) against the prebuilt .next
 * output shipped in this package. Usage: habena-web [--port 7700]
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let port = process.env.PORT || "7700";
const args = process.argv.slice(2);
const portFlag = args.findIndex((a) => a === "--port" || a === "-p");
if (portFlag !== -1 && args[portFlag + 1]) port = args[portFlag + 1];

const require = createRequire(import.meta.url);
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [packageRoot] });
} catch {
  console.error("habena-web: could not resolve the `next` package. Reinstall habena-web.");
  process.exit(1);
}

console.error(`Habena dashboard starting on http://localhost:${port}`);
const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
  cwd: packageRoot,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
