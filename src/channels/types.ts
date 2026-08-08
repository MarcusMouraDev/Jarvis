import type { PrivacyClass } from "@/core/types";

export interface ChannelMessage {
  id: string;
  channelId: string;
  text: string;
  at: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/** Adapter for an external communication channel (web, future WhatsApp, etc.). */
export interface ChannelAdapter {
  id: string;
  label: string;
  /** Whether the channel is available in the current environment. */
  isAvailable(): boolean;
  send(message: ChannelMessage): Promise<ChannelSendResult>;
  /** Optional inbound hook — web uses HTTP/SSE instead. */
  onMessage?(handler: (msg: ChannelMessage) => void): () => void;
}

export interface ChannelContext {
  profileId: string;
  privacyClass: PrivacyClass;
}
