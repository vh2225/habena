import { spawn } from "node:child_process";
import chalk from "chalk";

/**
 * `habena dashboard` — launch the local web dashboard.
 *
 * The dashboard ships as the separate `habena-web` package (it carries the
 * Next.js runtime, which would bloat the CLI install ~10x). npx fetches it
 * on first use and serves it from the npm cache afterwards.
 */
export function dashboardCommand(options: { port?: string } = {}): void {
  const port = options.port ?? "7700";
  console.error(chalk.gray("Launching the Habena dashboard (first run downloads habena-web)..."));
  const child = spawn("npx", ["--yes", "habena-web@latest", "--port", port], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("error", (err) => {
    console.error(chalk.red(`✗ Could not launch the dashboard: ${err.message}`));
    console.error(chalk.gray("  Try directly: npx habena-web"));
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}
