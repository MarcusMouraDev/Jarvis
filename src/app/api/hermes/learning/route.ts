import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore, readJsonBody, safeRouteError } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";
import { fetchHermesJson } from "@/integrations/hermes/dashboard";
import { HermesGatewayClient } from "@/integrations/hermes/gateway-client";
import { hermesHome } from "@/integrations/hermes/profile";

export const runtime = "nodejs";

interface Knobs {
  memoryNudgeInterval: number;
  backgroundReview: boolean;
}

function knobsFromConfig(raw: string): Knobs {
  try {
    const parsed = parseYaml(raw) as Record<string, unknown> | null;
    const memory = (parsed?.memory as Record<string, unknown> | undefined) ?? {};
    const auxiliary = (parsed?.auxiliary as Record<string, unknown> | undefined) ?? {};
    const review =
      (auxiliary.background_review as Record<string, unknown> | undefined) ?? {};
    return {
      memoryNudgeInterval: Number(memory.nudge_interval ?? 10),
      backgroundReview: review.enabled !== false,
    };
  } catch {
    return { memoryNudgeInterval: 10, backgroundReview: true };
  }
}

async function readSkills(home: string) {
  try {
    const dir = join(home, "skills");
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: join("skills", entry.name) }));
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  try {
    const home = hermesHome();
    const [skills, curatorFile, configRaw, curatorApi] = await Promise.all([
      readSkills(home),
      readFile(join(home, "state", "curator.json"), "utf8").catch(() => ""),
      readFile(join(home, "config.yaml"), "utf8").catch(() => ""),
      fetchHermesJson<unknown>("/api/curator"),
    ]);
    let frames: unknown = null;
    try {
      const client = new HermesGatewayClient();
      await client.connect(2500);
      frames = await client.request("learning.frames", {});
      client.close();
    } catch {
      frames = await fetchHermesJson("/api/learning/graph");
    }
    return jsonNoStore({
      skills,
      curator: curatorApi ?? curatorFile,
      frames,
      knobs: knobsFromConfig(configRaw),
    });
  } catch (error) {
    return safeRouteError(error);
  }
}

export async function POST(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  try {
    const body = (await readJsonBody(request)) as {
      memoryNudgeInterval?: number;
      backgroundReview?: boolean;
    };
    const path = join(hermesHome(), "config.yaml");
    const raw = await readFile(path, "utf8").catch(() => "");
    const parsed = (raw ? parseYaml(raw) : {}) as Record<string, unknown>;
    const memory = {
      ...((parsed.memory as Record<string, unknown> | undefined) ?? {}),
    };
    const auxiliary = {
      ...((parsed.auxiliary as Record<string, unknown> | undefined) ?? {}),
    };
    const review = {
      ...((auxiliary.background_review as Record<string, unknown> | undefined) ??
        {}),
    };
    if (typeof body.memoryNudgeInterval === "number") {
      memory.nudge_interval = body.memoryNudgeInterval;
    }
    if (typeof body.backgroundReview === "boolean") {
      review.enabled = body.backgroundReview;
    }
    auxiliary.background_review = review;
    parsed.memory = memory;
    parsed.auxiliary = auxiliary;
    await writeFile(path, stringifyYaml(parsed));
    return jsonNoStore({ ok: true, knobs: knobsFromConfig(stringifyYaml(parsed)) });
  } catch (error) {
    return safeRouteError(error);
  }
}
