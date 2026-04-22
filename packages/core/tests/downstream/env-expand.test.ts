import { describe, it, expect } from "vitest";
import { expandEnv, expandEnvInConfig } from "../../src/downstream/env-expand.js";
import { sanitizeEnv } from "../../src/downstream/client.js";

describe("expandEnv", () => {
  it("replaces simple ${VAR} references", () => {
    expect(expandEnv("hello ${USER}", { USER: "vinh" })).toBe("hello vinh");
  });

  it("replaces multiple references in one string", () => {
    expect(expandEnv("${A}-${B}", { A: "x", B: "y" })).toBe("x-y");
  });

  it("returns empty string for missing vars", () => {
    expect(expandEnv("${MISSING}", {})).toBe("");
  });

  it("leaves strings without ${...} unchanged", () => {
    expect(expandEnv("plain text", { USER: "vinh" })).toBe("plain text");
  });
});

describe("expandEnvInConfig", () => {
  it("expands nested string fields", () => {
    const config = {
      command: "${CMD}",
      args: ["--user=${USER}"],
      env: { TOKEN: "${API_KEY}" },
    };
    const result = expandEnvInConfig(config, { CMD: "npx", USER: "vinh", API_KEY: "secret" });
    expect(result).toEqual({
      command: "npx",
      args: ["--user=vinh"],
      env: { TOKEN: "secret" },
    });
  });

  it("leaves non-string values unchanged", () => {
    const config = { count: 42, flag: true, name: "${N}" };
    const result = expandEnvInConfig(config, { N: "hello" });
    expect(result).toEqual({ count: 42, flag: true, name: "hello" });
  });
});

describe("sanitizeEnv (security M1)", () => {
  it("strips PATH from config.env", () => {
    expect(sanitizeEnv({ PATH: "/tmp/evil:/usr/bin", FOO: "bar" })).toEqual({
      FOO: "bar",
    });
  });

  it("strips dynamic-linker hijack keys", () => {
    const hostile = {
      LD_PRELOAD: "/tmp/hook.so",
      LD_LIBRARY_PATH: "/tmp/evil",
      DYLD_INSERT_LIBRARIES: "/tmp/hook.dylib",
      DYLD_LIBRARY_PATH: "/tmp/evil",
      NODE_OPTIONS: "--require /tmp/hook.js",
      NODE_PATH: "/tmp/evil",
      OK: "keep me",
    };
    expect(sanitizeEnv(hostile)).toEqual({ OK: "keep me" });
  });

  it("returns {} for undefined", () => {
    expect(sanitizeEnv(undefined)).toEqual({});
  });

  it("passes through ordinary keys untouched", () => {
    expect(sanitizeEnv({ API_KEY: "abc", HOME_OVERRIDE: "/x" })).toEqual({
      API_KEY: "abc",
      HOME_OVERRIDE: "/x",
    });
  });
});
