import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import chalk from "chalk";
import { join } from "node:path";
import { getConfigPath, getAgentsPath, getAuditDbPath, getConfigDir, expandHome } from "../../config/paths.js";
import { loadSignatureFeed } from "../../threat/signatures.js";
import { loadYaml, loadConfigWithPacks, loadHostPolicy } from "../../config/loader.js";
import type { AgentGuardConfig } from "../../policy/types.js";
import { PolicyEngine } from "../../policy/engine.js";
import { CostTracker } from "../../cost/tracker.js";
import { BudgetEnforcer } from "../../cost/budget.js";
import { AuditLogger } from "../../audit/logger.js";
import { InstanceTracker } from "../../identity/instances.js";
import { AgentRegistry } from "../../identity/registry.js";
import { ProxyDispatcher } from "../../proxy/server.js";
import { ApprovalQueue } from "../../approval/queue.js";
import { startChannels, stopChannels, type ApprovalChannel } from "../../approval/channel.js";
import { TelegramApprovalChannel } from "../../approval/channels/telegram.js";
import { TelegramApi } from "../../approval/channels/telegram-api.js";
import { IpcServer } from "../../ipc/server.js";
import { DownstreamManager } from "../../downstream/manager.js";
import { createMcpServer } from "../../proxy/server.js";
import { runDoctor } from "../../doctor/runner.js";
import { ThreatEngine } from "../../threat/engine.js";
import { ToolSnapshotStore } from "../../threat/snapshots.js";
import { resolveThreatConfig } from "../../threat/types.js";

export async function startCommand(): Promise<void> {
  const { config, missingPacks } = loadConfigWithPacks(getConfigPath());
  if (missingPacks.length > 0) {
    console.error(
      chalk.yellow(
        `! extends: could not resolve pack(s): ${missingPacks.join(", ")} — continuing without them`
      )
    );
  }
  const rules = config.rules ?? [];
  const budgetConfig = config.budget ?? {};

  const hostPolicy = loadHostPolicy();
  if (hostPolicy.missingPacks.length > 0) {
    console.error(
      chalk.yellow(
        `! host-policy extends: could not resolve pack(s): ${hostPolicy.missingPacks.join(", ")} — continuing without them`
      )
    );
  }
  if (hostPolicy.exists) {
    console.error(
      chalk.gray(
        `Host policy: ${hostPolicy.path} (${hostPolicy.rules.length} floor rule${hostPolicy.rules.length === 1 ? "" : "s"})`
      )
    );
  }

  const agentRegistry = new AgentRegistry(getAgentsPath());
  const agents = agentRegistry.list();

  const policy = new PolicyEngine(rules, hostPolicy.rules);
  const audit = new AuditLogger(getAuditDbPath());
  // Live meter readings write through to the audit DB so token counters
  // survive a restart; calls/spend are already persisted as audit entries.
  const tracker = new CostTracker({ resultTokens: (r) => audit.insertResultTokens(r) });

  // Hydrate counters from the persisted audit log — a proxy restart (or
  // crash) must not hand a runaway agent a fresh per-day budget.
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const past = audit.query({ since: monthStart, decision: "allow", limit: 250_000 });
    tracker.hydrateSpend(
      past.map((e) => ({
        agentType: e.agentType,
        instanceId: e.instanceId,
        tool: e.tool,
        cost: e.cost ?? 0,
        timestamp: e.timestamp,
      }))
    );
    tracker.hydrateResultTokens(audit.queryResultTokens(monthStart));
  } catch (err) {
    console.error(chalk.yellow(`! Budget counter hydration failed (continuing with fresh counters): ${(err as Error).message}`));
  }

  // Per-agent budgets from agents.yaml (habena agent add --budget-daily N)
  // override the global config amounts for that agent's calls.
  const agentBudgets = new Map(
    agents
      .filter((a) => a.permissions?.budget)
      .map((a) => [
        a.name,
        { daily: a.permissions.budget?.daily, per_session: a.permissions.budget?.per_session },
      ])
  );
  const budget = new BudgetEnforcer(
    tracker,
    budgetConfig,
    (msg) => console.error(chalk.yellow(`! ${msg}`)),
    agentBudgets
  );
  const instances = new InstanceTracker();

  const threatConfig = resolveThreatConfig(config.threat);
  // Local signature feed (threat.feed_file) — optional, no cloud sync. A
  // present-but-broken feed warns loudly instead of silently not protecting.
  let signatureFeed = null;
  if (threatConfig.feed_file) {
    try {
      signatureFeed = loadSignatureFeed(expandHome(threatConfig.feed_file));
      if (signatureFeed) {
        const n = signatureFeed.servers.length + signatureFeed.tools.length + signatureFeed.descriptionPatterns.length;
        console.error(chalk.gray(`Threat signatures: ${n} from ${threatConfig.feed_file}`));
      } else {
        console.error(chalk.yellow(`! threat.feed_file not found: ${threatConfig.feed_file} — continuing without signatures`));
      }
    } catch (err) {
      console.error(chalk.yellow(`! threat.feed_file unreadable (${(err as Error).message}) — continuing without signatures`));
    }
  }
  const threat = new ThreatEngine(
    threatConfig,
    new ToolSnapshotStore(join(getConfigDir(), "tool-snapshots.json")),
    signatureFeed
  );

  // Approval queue + IPC server
  const approval = new ApprovalQueue({
    timeoutAction: config.approval?.timeout_action ?? "deny",
  });
  const socketPath = join(getConfigDir(), "agentguard.sock");
  const ipcServer = new IpcServer(approval, socketPath);
  try {
    await ipcServer.start();
    console.error(chalk.gray(`IPC:    ${socketPath}`));
  } catch (err) {
    console.error(chalk.yellow(`! Failed to start IPC server: ${(err as Error).message}`));
    console.error(chalk.yellow("  Approval requests will auto-deny."));
  }

  // Out-of-band approval channels. Constructed here, started after the proxy
  // is otherwise up, stopped in the shutdown path. A channel that fails to
  // start must never crash the proxy (startChannels logs + continues).
  const channels: ApprovalChannel[] = [];
  const telegramCfg = config.approval?.channels?.telegram;
  if (telegramCfg) {
    const token =
      telegramCfg.token ??
      (telegramCfg.token_env ? process.env[telegramCfg.token_env] : undefined);
    if (!token || telegramCfg.owner_id === undefined || telegramCfg.owner_id === "") {
      console.error(
        chalk.yellow(
          "! telegram approval channel configured but no token/owner_id; skipping"
        )
      );
    } else {
      channels.push(
        new TelegramApprovalChannel(approval, {
          api: new TelegramApi(token),
          ownerId: telegramCfg.owner_id,
        })
      );
    }
  }

  const dispatcher = new ProxyDispatcher({
    policy,
    tracker,
    budget,
    audit,
    instances,
    approval,
    threat,
    pricing: config.pricing,
    approvalTimeoutMs: parseDurationToMs(config.approval?.timeout ?? "5m"),
  });

  // Spawn downstream MCP servers
  const downstream = new DownstreamManager(config.mcp_servers ?? {});
  // Scan findings already reported, so periodic re-scans only log what's new.
  const seenFindings = new Set<string>();
  const findingKey = (f: { tool: string; detector: string; message: string }) =>
    `${f.tool}|${f.detector}|${f.message}`;
  try {
    await downstream.start();
    const status = downstream.status();
    const healthy = status.filter((s) => s.alive && s.authStatus !== "auth_failed").length;
    const total = status.length;
    console.error(chalk.gray(`Downstreams: ${healthy}/${total} healthy`));
    for (const s of status) {
      if (!s.alive) {
        console.error(chalk.yellow(`  ✗ ${s.name}: ${s.error}`));
        continue;
      }
      if (s.authStatus === "auth_failed") {
        console.error(
          chalk.yellow(
            `  ⚠ ${s.name} (${s.toolCount} tools, auth failed: ${s.authError ?? "unknown"})`
          )
        );
      } else if (s.authStatus === "authenticated") {
        console.error(chalk.gray(`  ✓ ${s.name} (${s.toolCount} tools, authenticated)`));
      } else {
        console.error(chalk.gray(`  ✓ ${s.name} (${s.toolCount} tools, auth unchecked)`));
      }
    }
    const scan = threat.scanTools(downstream.listTools());
    for (const f of scan.findings) seenFindings.add(findingKey(f));
    if (scan.flagged > 0) {
      console.error(chalk.yellow(`! Threat scan: ${scan.flagged}/${scan.scanned} tool(s) flagged`));
      for (const f of scan.findings) {
        console.error(chalk.yellow(`  ⚠ ${f.tool}: ${f.detector} (${f.severity}): ${f.message}`));
      }
      console.error(chalk.gray("  Flagged tools require approval on use (configurable via `threat:` in config.yaml)."));
    }
  } catch (err) {
    console.error(chalk.yellow(`! Downstream startup failed: ${(err as Error).message}`));
  }

  const mcpServer = createMcpServer({
    dispatcher,
    downstream,
    instances,
    tracker,
  });

  // Mid-session threat re-scan: a rug-pull can happen while the proxy is
  // running, not just across restarts. Periodically re-fetch downstream tool
  // lists, re-run the scan, and report only new findings. Flags are sticky
  // for the session (see ThreatEngine). `threat.rescan_interval: off` disables.
  if (threatConfig.rescan_interval !== "off") {
    const rescanMs = parseDurationToMs(threatConfig.rescan_interval);
    const rescanTimer = setInterval(async () => {
      try {
        const before = downstream.listTools().map((t) => t.name).sort().join("\n");
        const { failed } = await downstream.refresh();
        const scan = threat.scanTools(downstream.listTools());
        const fresh = scan.findings.filter((f) => !seenFindings.has(findingKey(f)));
        for (const f of fresh) seenFindings.add(findingKey(f));
        if (fresh.length > 0) {
          console.error(chalk.yellow(`! Threat re-scan: ${fresh.length} new finding(s)`));
          for (const f of fresh) {
            console.error(chalk.yellow(`  ⚠ ${f.tool}: ${f.detector} (${f.severity}): ${f.message}`));
          }
        }
        if (failed.length > 0) {
          console.error(chalk.gray(`  (tool refresh failed for: ${failed.join(", ")} — keeping cached catalogs)`));
        }
        const after = downstream.listTools().map((t) => t.name).sort().join("\n");
        if (before !== after) {
          await mcpServer.sendToolListChanged();
        }
      } catch {
        // A failed re-scan must never crash the proxy; next tick retries.
      }
    }, rescanMs);
    rescanTimer.unref();
  }

  console.error(chalk.green("Habena proxy started (stdio transport)"));
  console.error(chalk.gray(`Config: ${getConfigPath()}`));
  console.error(chalk.gray(`Audit: ${getAuditDbPath()}`));
  console.error(chalk.gray(`Registered agents: ${agents.length}`));

  // Boot-time doctor subset — checks that are safe to run at startup
  // (skip proxy-reachable + downstream-reachable: we just started them,
  // they're covered above). Silent on pass; prints a one-liner if any
  // check comes back non-green.
  runDoctor({ only: ["node-version", "audit-db-writable", "openclaw-pointed-at-us"] })
    .then((results) => {
      const problems = results.filter((r) => r.status !== "pass");
      if (problems.length === 0) return;
      for (const p of problems) {
        const icon = p.status === "warn" ? chalk.yellow("⚠") : chalk.red("✗");
        console.error(`${icon} ${chalk.bold(p.name)}: ${p.detail}`);
        if (p.fixHint) console.error(chalk.gray(`  └─ ${p.fixHint}`));
      }
      console.error(chalk.gray("  (run `habena doctor` for the full report)"));
    })
    .catch(() => { /* boot checks are advisory; never block startup */ });

  // Start approval channels best-effort (after the proxy is otherwise up).
  await startChannels(channels, { warn: (msg) => console.error(chalk.yellow(msg)) });

  const shutdown = async () => {
    console.error(chalk.yellow("\nShutting down Habena..."));
    await stopChannels(channels);
    await downstream.stop().catch(() => {});
    await ipcServer.stop().catch(() => {});
    approval.shutdown();
    audit.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h)$/);
  if (!match) return 5 * 60 * 1000;
  const v = parseInt(match[1], 10);
  const unit = match[2];
  return unit === "s" ? v * 1000 : unit === "m" ? v * 60 * 1000 : v * 60 * 60 * 1000;
}
