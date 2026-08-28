import { homedir } from "node:os";
import { join } from "node:path";

export function hermesHome(): string {
  return (
    process.env.HERMES_HOME?.trim() ||
    join(homedir(), ".hermes", "profiles", "jarvis")
  );
}

export function hermesGatewayHttp(): string {
  return process.env.HERMES_GATEWAY_HTTP?.trim() || "http://127.0.0.1:9119";
}
