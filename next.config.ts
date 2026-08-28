import type { NextConfig } from "next";

const isVpsSafeBuild = process.env.JARVIS_BUILD_PROFILE !== "desktop-legacy";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["three"],
  // Cursor SDK bundles Node-only assets that Turbopack cannot type as modules.
  serverExternalPackages: ["@cursor/sdk"],
  // Allow LAN access in `next dev` (phone / other machines on the network).
  allowedDevOrigins: ["192.168.0.139", "127.0.0.1", "localhost"],
  // Electron is used only by the desktop profile. In the VPS-safe profile all
  // legacy executor endpoints reject before reaching it, so tracing its binary
  // would only inflate the server image.
  ...(isVpsSafeBuild
    ? {
        outputFileTracingExcludes: {
          "/*": ["./node_modules/electron/**/*"],
        },
      }
    : {}),
};

export default nextConfig;
