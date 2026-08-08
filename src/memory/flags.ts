export function isMemoryEnabled(): boolean {
  return process.env.JARVIS_MEMORY === "1";
}
