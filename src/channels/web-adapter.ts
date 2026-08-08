/**
 * Web UI channel — the default in-app conversation surface.
 *
 * Other channels (WhatsApp, Telegram, Slack, etc.) must implement
 * ChannelAdapter with:
 * - Authentication (tokens, webhook secrets)
 * - Rate limiting per sender/session
 * - Privacy class mapping before forwarding to the orchestrator
 *
 * WhatsApp is intentionally not implemented in Phase 6.
 */
import type { ChannelAdapter, ChannelMessage, ChannelSendResult } from "./types";

export const webChannelAdapter: ChannelAdapter = {
  id: "web",
  label: "Web UI",

  isAvailable() {
    return typeof window !== "undefined" || process.env.NODE_ENV !== "production";
  },

  async send(message: ChannelMessage): Promise<ChannelSendResult> {
    return { ok: true, messageId: message.id };
  },
};
