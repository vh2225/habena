/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native addon must resolve from node_modules at runtime (per-platform
  // prebuilt binary), not be bundled into the build output.
  serverExternalPackages: ["better-sqlite3"],
};

module.exports = nextConfig;
