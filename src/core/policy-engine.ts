import { getProfile } from "./profiles";
import { canSendToProvider } from "./policy";
import type { PrivacyClass } from "./types";
import type { ToolRisk } from "@/tools/registry";
import { getTool } from "@/tools/registry";

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  needsApproval?: boolean;
}

export interface PolicyCheckInput {
  profileId: string;
  privacyClass: PrivacyClass;
  provider?: string;
  modelAlias?: string;
  toolId?: string;
  risk?: ToolRisk;
}

const RISKY_TOOLS = new Set<ToolRisk>(["write", "network", "destructive"]);

export function evaluatePolicy(input: PolicyCheckInput): PolicyDecision {
  const profile = getProfile(input.profileId);
  if (!profile) {
    return { allowed: false, reason: "profile_not_found" };
  }

  if (input.provider && !canSendToProvider(input.privacyClass, input.provider)) {
    return { allowed: false, reason: "privacy_blocked" };
  }

  if (
    input.modelAlias &&
    !profile.allowedModels.includes(input.modelAlias)
  ) {
    return { allowed: false, reason: "model_not_allowed" };
  }

  if (input.toolId) {
    if (!profile.allowedTools.includes(input.toolId)) {
      return { allowed: false, reason: "tool_not_allowed" };
    }

    const tool = getTool(input.toolId);
    const risk = input.risk ?? tool?.risk ?? "read";
    const needsApproval =
      tool?.policy.defaultTier === "confirm" || RISKY_TOOLS.has(risk);

    if (input.privacyClass === "secret") {
      return { allowed: false, reason: "privacy_blocked" };
    }

    return { allowed: true, needsApproval };
  }

  return { allowed: true };
}
