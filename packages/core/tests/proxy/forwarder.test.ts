import { describe, it, expect } from "vitest";
import { Forwarder } from "../../src/proxy/forwarder.js";

describe("Forwarder", () => {
  it("registers a downstream server", () => {
    const fwd = new Forwarder();
    fwd.addServer({ name: "github", command: "mcp-server-github" });
    expect(fwd.listServers().map((s) => s.name)).toContain("github");
  });

  it("routes tool name prefix to server", () => {
    const fwd = new Forwarder();
    fwd.addServer({ name: "github", command: "x", toolPrefixes: ["github_"] });
    fwd.addServer({ name: "filesystem", command: "y", toolPrefixes: ["filesystem_"] });
    expect(fwd.routeFor("github_search")?.name).toBe("github");
    expect(fwd.routeFor("filesystem_write")?.name).toBe("filesystem");
  });

  it("returns undefined when no route matches", () => {
    const fwd = new Forwarder();
    fwd.addServer({ name: "github", command: "x", toolPrefixes: ["github_"] });
    expect(fwd.routeFor("unknown_tool")).toBeUndefined();
  });

  it("removes a server", () => {
    const fwd = new Forwarder();
    fwd.addServer({ name: "github", command: "x" });
    fwd.removeServer("github");
    expect(fwd.listServers()).toHaveLength(0);
  });
});
