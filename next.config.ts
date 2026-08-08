import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["three"],
  // Cursor SDK bundles Node-only assets that Turbopack cannot type as modules.
  serverExternalPackages: ["@cursor/sdk"],
};

export default nextConfig;
