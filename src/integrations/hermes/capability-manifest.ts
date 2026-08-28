export type HermesCapabilityOwner = "vps-native" | "jarvis-ui" | "companion-local";
export interface HermesCapabilityBinding { owner: HermesCapabilityOwner; surface: string }
export interface HermesCapabilityManifest {
  revision: string;
  capabilities: Readonly<Record<string, HermesCapabilityBinding>>;
}

export const HERMES_PINNED_CAPABILITIES = [
  "sessions", "attachments", "approvals", "subagents", "clarifications", "task_graph",
  "cron", "messaging", "memory", "voice", "computer_use", "plugins", "skills", "files",
  "terminal", "git", "profiles", "diagnostics",
] as const;

/** Pinned Hermes surface; each entry resolves to a typed route, UI, or companion boundary. */
export const HERMES_CAPABILITY_MANIFEST: HermesCapabilityManifest = {
  revision: "hermes-2026-08-25",
  capabilities: {
    sessions: { owner: "vps-native", surface: "src/app/api/hermes/sessions/route.ts" },
    attachments: { owner: "jarvis-ui", surface: "src/app/api/workspaces/[id]/uploads/route.ts" },
    approvals: { owner: "jarvis-ui", surface: "src/app/api/approvals/[approvalId]/route.ts" },
    subagents: { owner: "jarvis-ui", surface: "src/ui/SubagentRail.tsx" },
    clarifications: { owner: "jarvis-ui", surface: "src/ui/SafeClarifyCard.tsx" },
    task_graph: { owner: "jarvis-ui", surface: "src/ui/TaskGraphPanel.tsx" },
    cron: { owner: "vps-native", surface: "src/app/api/hermes/cron/route.ts" },
    messaging: { owner: "vps-native", surface: "src/app/api/hermes/channels/route.ts" },
    memory: { owner: "vps-native", surface: "src/app/api/hermes/memory/route.ts" },
    voice: { owner: "companion-local", surface: "src/app/api/devices/jobs/route.ts" },
    computer_use: { owner: "companion-local", surface: "src/app/api/devices/jobs/route.ts" },
    plugins: { owner: "vps-native", surface: "src/app/api/hermes/control/route.ts" },
    skills: { owner: "vps-native", surface: "src/app/api/skills/route.ts" },
    files: { owner: "vps-native", surface: "src/app/api/files/[fileId]/route.ts" },
    terminal: { owner: "vps-native", surface: "src/app/api/tools/shell/route.ts" },
    git: { owner: "vps-native", surface: "src/core/tool-gateway.ts" },
    profiles: { owner: "vps-native", surface: "src/app/api/profiles/route.ts" },
    diagnostics: { owner: "jarvis-ui", surface: "src/app/api/hermes/health/route.ts" },
  },
};

export function assertHermesCapabilitiesMapped(
  discovered: readonly string[],
  manifest: HermesCapabilityManifest = HERMES_CAPABILITY_MANIFEST,
): void {
  const unmapped = discovered.filter((capability) => !manifest.capabilities[capability]);
  if (unmapped.length) throw new Error(`hermes_capability_unmapped:${unmapped.join(",")}`);
}
