/** Phase 6 feature flags — all OFF by default. */

export function isMcpBrasilEnabled(): boolean {
  return process.env.JARVIS_MCP_BRASIL === "1";
}

export function isBrowserEnabled(): boolean {
  return process.env.JARVIS_BROWSER === "1";
}

export function isBrowserMockMode(): boolean {
  return (
    process.env.JARVIS_BROWSER_MOCK === "1" ||
    process.env.NODE_ENV === "test"
  );
}

export function isSchedulerEnabled(): boolean {
  return process.env.JARVIS_SCHEDULER === "1";
}
