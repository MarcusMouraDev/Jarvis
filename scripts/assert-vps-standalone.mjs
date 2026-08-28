import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const standalone = join(process.cwd(), ".next", "standalone");
const forbidden = [join(standalone, "node_modules", "electron")];

for (const target of forbidden) {
  if (existsSync(target)) {
    throw new Error(`vps_standalone_forbidden_dependency:${target}`);
  }
}

const traceRoot = join(process.cwd(), ".next", "server", "app", "api");
const authOnlyTraces = [
  "devices/route.js.nft.json",
  "devices/pair/route.js.nft.json",
  "devices/[deviceId]/route.js.nft.json",
  "devices/[deviceId]/jobs/route.js.nft.json",
  "hermes/channels/route.js.nft.json",
  "hermes/computer-use/route.js.nft.json",
  "hermes/cron/route.js.nft.json",
  "hermes/health/route.js.nft.json",
  "hermes/learning/route.js.nft.json",
  "hermes/memory/route.js.nft.json",
  "hermes/voice/route.js.nft.json",
  "hermes/wake/route.js.nft.json",
  "omniroute/usage/route.js.nft.json",
  "preferences/route.js.nft.json",
  "runs/[runId]/events/route.js.nft.json",
  "telegram/link-codes/route.js.nft.json",
];

for (const relativeTrace of authOnlyTraces) {
  const tracePath = join(traceRoot, relativeTrace);
  const files = JSON.parse(readFileSync(tracePath, "utf8")).files ?? [];
  if (files.some((file) => file.includes("@cursor/sdk"))) {
    throw new Error(`vps_auth_route_heavy_runtime:${relativeTrace}`);
  }
}
