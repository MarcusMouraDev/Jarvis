export type AgentState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "asking"
  | "failure";

export type PrivacyClass = "public" | "internal" | "confidential" | "secret";

export type MicPermission =
  | "unknown"
  | "prompting"
  | "granted"
  | "denied"
  | "unavailable";

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface TextRequest {
  provider: string;
  model: string;
  requestId: string;
  purpose: string;
  privacyClass: PrivacyClass;
  maxCostUsd?: number;
  prompt: string;
}

export interface TextResponse {
  provider: string;
  model: string;
  requestId: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  requestedAlias?: string;
  usage: Usage;
  text: string;
}

export interface VoiceRequest {
  voiceId: string;
  locale: string;
  audioFormat: string;
  text: string;
  requestId: string;
}

export interface VoiceResponse {
  voiceId: string;
  locale: string;
  audioFormat: string;
  audioPath: string;
  requestId: string;
  characters: number;
}

export interface ModelAliasConfig {
  provider: string;
  adapter: string;
  envKey?: string;
  auth?: string;
  fallback: string[];
}

export interface JarvisConfig {
  version: number;
  mode: string;
  defaultModel: string;
  models: Record<string, ModelAliasConfig>;
  voice: {
    provider: string;
    adapter: string;
    envKey: string;
    locale: string;
    voiceId: string;
    autoPlay: boolean;
    autoRead: boolean;
    audioFormat: string;
    keepAudio: boolean;
    tempTtlSeconds: number;
    maxCharactersPerRequest: number;
    fallback: string[];
  };
  policies: {
    logContent: boolean;
    requireConfirmationForCodeChanges: boolean;
    requireConfirmationForNetworkOrDestructiveCommands: boolean;
    maxFallbackAttempts: number;
    redactSecrets: boolean;
    voiceRequiresFirstUseNotice: boolean;
    deleteTemporaryAudioAfterPlayback: boolean;
  };
}

export interface TelemetryEvent {
  requestId: string;
  alias: string;
  effectiveProvider: string;
  latencyMs: number;
  status: "ok" | "error" | "fallback";
  fallbackReason?: string;
  usage?: Usage;
  voiceCharacters?: number;
}
