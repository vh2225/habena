import { createRequire } from "node:module";

// Single source of truth for the package version. Resolves package.json
// relative to this file, which sits one level below the package root in
// both the src/ tree and the compiled dist/ tree.
const require = createRequire(import.meta.url);

export const VERSION: string = (require("../package.json") as { version: string }).version;
