/** Aliases do Safe Agent Core (config/agents.yaml). */
export const SAFE_MODEL_ALIASES = [
  "gemini",
  "cursor-text",
  "local",
  "codex-openai",
] as const;

/** Aliases exibidos no @ — OmniRoute aparece pelo nome amigável. */
export const SAFE_MODEL_PICKER_ALIASES = [
  "omniroute",
  "gemini",
  "cursor-text",
  "codex-openai",
] as const;

export type SafeModelAlias = (typeof SAFE_MODEL_ALIASES)[number];

const ALIAS_MAP: Record<string, SafeModelAlias> = {
  gemini: "gemini",
  "cursor-text": "cursor-text",
  cursor: "cursor-text",
  local: "local",
  "local-openai": "local",
  omniroute: "local",
  omni: "local",
  "codex-openai": "codex-openai",
  codex: "codex-openai",
};

export const SAFE_MODEL_LABELS: Record<string, { label: string; detail: string }> = {
  gemini: { label: "gemini", detail: "Google · Gemini" },
  "cursor-text": { label: "cursor-text", detail: "Cursor · Agent" },
  omniroute: { label: "omniroute", detail: "OmniRoute · localhost:20128" },
  local: { label: "omniroute", detail: "OmniRoute · localhost:20128" },
  "codex-openai": { label: "codex-openai", detail: "OpenAI · Codex" },
  codex: { label: "codex-openai", detail: "OpenAI · Codex" },
};

export function resolveSafeModelAlias(
  raw: string | undefined | null,
  available: readonly string[] = SAFE_MODEL_ALIASES,
): SafeModelAlias | null {
  if (!raw?.trim()) return null;
  const key = raw.trim().toLowerCase();
  const mapped = ALIAS_MAP[key] ?? (key as SafeModelAlias);
  return available.includes(mapped) ? mapped : null;
}

/** Extrai `@modelo` no início do texto (quando o usuário digita sem aceitar o chip). */
export function extractLeadingModelMention(text: string): {
  alias: string;
  rest: string;
} | null {
  const match = text.match(/^@([A-Za-z0-9][A-Za-z0-9._-]*)\b\s*/);
  if (!match?.[1]) return null;
  return {
    alias: match[1],
    rest: text.slice(match[0].length).trimStart(),
  };
}

export function isPaidSafeModel(alias: string): boolean {
  return alias === "gemini" || alias === "codex-openai";
}

export function displayNameForSafeModel(alias: string): string {
  return SAFE_MODEL_LABELS[alias]?.label ?? alias;
}
