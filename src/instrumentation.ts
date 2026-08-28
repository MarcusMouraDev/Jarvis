export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.JARVIS_ROLE !== "worker" || !process.env.JARVIS_TELEGRAM_BOT_TOKEN) return;
  const marker = globalThis as typeof globalThis & { __jarvisTelegramWorker?: boolean };
  if (marker.__jarvisTelegramWorker) return;
  marker.__jarvisTelegramWorker = true;
  const { runTelegramWorker } = await import("@/integrations/telegram/worker");
  void runTelegramWorker(process.env.JARVIS_TELEGRAM_BOT_TOKEN);
}
