import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export type MemoryPolicy = "off" | "manual" | "consent";

export interface JarvisProfile {
  id: string;
  allowedModels: string[];
  allowedTools: string[];
  budgetUsd: number;
  memoryPolicy: MemoryPolicy;
  timeoutMs: number;
}

const profileSchema = z.object({
  allowed_models: z.array(z.string()),
  allowed_tools: z.array(z.string()).default([]),
  budget_usd: z.number().positive(),
  memory_policy: z.enum(["off", "manual", "consent"]),
  timeout_ms: z.number().int().positive(),
});

const yamlSchema = z.object({
  profiles: z.record(z.string(), profileSchema),
});

const DEFAULT_PROFILES: Record<string, JarvisProfile> = {
  conversa: {
    id: "conversa",
    allowedModels: ["gemini", "deepseek-flash", "codex"],
    allowedTools: ["shell.run"],
    budgetUsd: 2,
    memoryPolicy: "manual",
    timeoutMs: 120_000,
  },
  pesquisa: {
    id: "pesquisa",
    allowedModels: ["gemini", "deepseek-flash", "deepseek-pro"],
    allowedTools: ["shell.run", "mcp_brasil.query", "browser.run"],
    budgetUsd: 5,
    memoryPolicy: "consent",
    timeoutMs: 180_000,
  },
  briefing: {
    id: "briefing",
    allowedModels: ["gemini", "deepseek-pro"],
    allowedTools: [],
    budgetUsd: 1.5,
    memoryPolicy: "off",
    timeoutMs: 90_000,
  },
  monitor: {
    id: "monitor",
    allowedModels: ["gemini", "deepseek-flash"],
    allowedTools: ["shell.run"],
    budgetUsd: 3,
    memoryPolicy: "manual",
    timeoutMs: 60_000,
  },
};

let cachedProfiles: Record<string, JarvisProfile> | null = null;

function mapProfiles(
  raw: z.infer<typeof yamlSchema>["profiles"],
): Record<string, JarvisProfile> {
  const out: Record<string, JarvisProfile> = {};
  for (const [id, p] of Object.entries(raw)) {
    out[id] = {
      id,
      allowedModels: p.allowed_models,
      allowedTools: p.allowed_tools,
      budgetUsd: p.budget_usd,
      memoryPolicy: p.memory_policy,
      timeoutMs: p.timeout_ms,
    };
  }
  return out;
}

export function loadProfilesFromYaml(raw: string): Record<string, JarvisProfile> {
  const parsed = yamlSchema.parse(parseYaml(raw));
  return mapProfiles(parsed.profiles);
}

function loadProfilesFromDisk(): Record<string, JarvisProfile> {
  try {
    const filePath = resolve(process.cwd(), "config/profiles.yaml");
    const raw = readFileSync(filePath, "utf8");
    return loadProfilesFromYaml(raw);
  } catch {
    return DEFAULT_PROFILES;
  }
}

export function listProfiles(): JarvisProfile[] {
  if (!cachedProfiles) cachedProfiles = loadProfilesFromDisk();
  return Object.values(cachedProfiles);
}

export function getProfile(profileId: string): JarvisProfile | null {
  if (!cachedProfiles) cachedProfiles = loadProfilesFromDisk();
  return cachedProfiles[profileId] ?? null;
}

/** Test helper — reset cached profiles. */
export function clearProfileCache() {
  cachedProfiles = null;
}
