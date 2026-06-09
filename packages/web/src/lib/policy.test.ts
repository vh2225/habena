import { describe, it, expect } from "vitest";
import { actionKind } from "./policy";

describe("actionKind", () => {
  it("maps policy actions to badge kinds", () => {
    expect(actionKind("allow")).toBe("allow");
    expect(actionKind("deny")).toBe("deny");
    expect(actionKind("deny_if")).toBe("deny");
    expect(actionKind("deny_unless")).toBe("deny");
    expect(actionKind("require_approval")).toBe("warn");
    expect(actionKind("anything-else")).toBe("neutral");
  });
});
