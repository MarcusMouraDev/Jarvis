import { z } from "zod";

export const safeToolIds = [
  "code.context",
  "terminal.read",
  "terminal.run",
  "file.patch",
  "project.create",
] as const;

export type SafeToolId = (typeof safeToolIds)[number];
export type SafeToolRisk = "read" | "write" | "network" | "system" | "destructive";
export type SafeToolSideEffect = "none" | "local" | "external";

export interface SafeToolManifest {
  id: SafeToolId;
  version: string;
  description: string;
  risk: SafeToolRisk;
  sideEffect: SafeToolSideEffect;
  requiredScopes: readonly string[];
  idempotent: boolean;
  supportsPreview: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
}

const relativePath = z.string().min(1).max(512);
const processOutput = z
  .object({
    exitCode: z.number().int().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    timedOut: z.boolean(),
  })
  .strict();

const manifests: Record<SafeToolId, SafeToolManifest> = {
  "code.context": {
    id: "code.context",
    version: "1.0.0",
    description: "Reads bounded source context inside the run's frozen workspace.",
    risk: "read",
    sideEffect: "none",
    requiredScopes: ["workspace:read"],
    idempotent: true,
    supportsPreview: false,
    timeoutMs: 10_000,
    maxOutputBytes: 100_000,
    inputSchema: z.object({ paths: z.array(relativePath).min(1).max(6) }).strict(),
    outputSchema: z
      .object({
        files: z.array(
          z
            .object({
              path: relativePath,
              sha256: z.string().regex(/^[a-f\d]{64}$/),
              bytes: z.number().int().nonnegative(),
              content: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  "terminal.read": {
    id: "terminal.read",
    version: "1.2.0",
    description: "Runs a narrow structured allowlist of read-only local commands.",
    risk: "read",
    sideEffect: "none",
    requiredScopes: ["workspace:read", "process:read"],
    idempotent: true,
    supportsPreview: false,
    timeoutMs: 15_000,
    maxOutputBytes: 200_000,
    inputSchema: z
      .object({
        program: z.string().min(1).max(32),
        args: z.array(z.string().max(512)).max(64),
      })
      .strict(),
    outputSchema: processOutput,
  },
  "terminal.run": {
    id: "terminal.run",
    version: "1.3.0",
    description: "Runs one exact approved project script through a pinned non-login shell.",
    risk: "system",
    sideEffect: "local",
    requiredScopes: ["workspace:write", "process:run"],
    idempotent: false,
    supportsPreview: true,
    timeoutMs: 120_000,
    maxOutputBytes: 200_000,
    inputSchema: z
      .object({
        program: z.string().min(1).max(32),
        args: z.array(z.string().max(512)).max(64),
        script: z.string().min(1).max(128).optional(),
      })
      .strict(),
    outputSchema: processOutput,
  },
  "file.patch": {
    id: "file.patch",
    version: "1.0.0",
    description: "Previews and applies an exact preimage-hash-bound unified text patch.",
    risk: "write",
    sideEffect: "local",
    requiredScopes: ["workspace:write"],
    idempotent: false,
    supportsPreview: true,
    timeoutMs: 30_000,
    maxOutputBytes: 200_000,
    inputSchema: z
      .object({
        diff: z.string().min(1).max(500_000),
        preimageHashes: z.record(relativePath, z.string().regex(/^[a-f\d]{64}$/i)),
      })
      .strict(),
    outputSchema: z
      .object({
        applied: z.boolean(),
        paths: z.array(relativePath),
        diff: z.string(),
      })
      .strict(),
  },
  "project.create": {
    id: "project.create",
    version: "1.0.0",
    description: "Creates the one frozen, previously nonexistent direct project child.",
    risk: "system",
    sideEffect: "local",
    requiredScopes: ["project:create"],
    idempotent: false,
    supportsPreview: true,
    timeoutMs: 10_000,
    maxOutputBytes: 10_000,
    inputSchema: z.object({ name: z.string().min(1).max(64) }).strict(),
    outputSchema: z
      .object({ name: z.string(), path: z.string(), created: z.boolean() })
      .strict(),
  },
};

export function getSafeToolManifest(id: string): SafeToolManifest | null {
  return Object.prototype.hasOwnProperty.call(manifests, id)
    ? manifests[id as SafeToolId]
    : null;
}

export function listSafeToolManifests(): SafeToolManifest[] {
  return safeToolIds.map((id) => manifests[id]);
}
