export type OmniCommandKind = "serve" | "start" | "dev" | "sidecar-dev";

export function resolveOmniCommand(input: {
  hasServeBundle: boolean;
  hasProdBuild: boolean;
  omniDev: boolean;
}): OmniCommandKind {
  if (input.omniDev) return "dev";
  if (input.hasServeBundle) return "serve";
  if (input.hasProdBuild) return "start";
  return "sidecar-dev";
}

export function omniStartShellCommand(
  kind: OmniCommandKind,
  memoryMb = 768,
): string {
  if (kind === "dev") return "PORT=20128 npm run dev";
  if (kind === "start") return "PORT=20128 npm start";
  if (kind === "sidecar-dev") {
    return `OMNIROUTE_MEMORY_MB=${memoryMb} PORT=20128 node --max-old-space-size=${memoryMb} scripts/dev/run-next.mjs dev`;
  }
  return `OMNIROUTE_MEMORY_MB=${memoryMb} PORT=20128 node bin/omniroute.mjs serve --no-open --no-tray --port 20128`;
}

export function resolveJarvisCommand(input: {
  electron: boolean;
  nextDev: boolean;
  hasNextBuild: boolean;
}): string {
  if (input.electron && !input.nextDev && input.hasNextBuild) return "npm start";
  return "npm run dev";
}

export function hasOmniServeBundle(omniRoot: string, exists: (path: string) => boolean): boolean {
  return exists(`${omniRoot}/dist/server.js`) || exists(`${omniRoot}/app/server.js`);
}

export function hasOmniProdBuild(omniRoot: string, exists: (path: string) => boolean): boolean {
  return (
    exists(`${omniRoot}/.build/next/BUILD_ID`) ||
    exists(`${omniRoot}/.next/BUILD_ID`)
  );
}
