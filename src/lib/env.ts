export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function geminiModelId(): string {
  return optionalEnv("GEMINI_MODEL", "gemini-2.5-flash");
}

export function cursorModelId(): string {
  return optionalEnv("CURSOR_MODEL", "composer-2.5");
}

export function cursorAgentCwd(): string {
  return optionalEnv("CURSOR_AGENT_CWD", process.cwd());
}
