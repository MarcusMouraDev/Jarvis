import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["three"],
  // Cursor SDK bundles Node-only assets that Turbopack cannot type as modules.
  serverExternalPackages: ["@cursor/sdk"],
  // Allow LAN access in `next dev` (phone / other machines on the network).
  allowedDevOrigins: ["192.168.0.139", "127.0.0.1", "localhost"],
};

export default nextConfig;
