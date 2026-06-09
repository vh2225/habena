import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Auto-cleanup the rendered DOM between tests. RTL only registers this
// automatically when `globals: true`; this project runs without globals,
// so wire it up explicitly to avoid renders accumulating across tests.
afterEach(() => {
  cleanup();
});
