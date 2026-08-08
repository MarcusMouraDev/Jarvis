import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { JarvisConfig } from "./types";

const modelSchema = z.object({
  provider: z.string(),
  adapter: z.string(),
  env_key: z.string().optional(),
  auth: z.string().optional(),
  fallback: z.array(z.string()).default([]),
});

const yamlSchema = z.object({
  version: z.number(),
  mode: z.string(),
  default_model: z.string(),
  models: z.record(z.string(), modelSchema),
  voice: z.object({
    provider: z.string(),
    adapter: z.string(),
    env_key: z.string(),
    locale: z.string(),
    voice_id: z.string(),
    auto_play: z.boolean(),
    auto_read: z.boolean(),
    audio_format: z.string(),
    keep_audio: z.boolean(),
    temp_ttl_seconds: z.number(),
    max_characters_per_request: z.number(),
    fallback: z.array(z.string()).default([]),
  }),
  policies: z.object({
    log_content: z.boolean(),
    require_confirmation_for_code_changes: z.boolean(),
    require_confirmation_for_network_or_destructive_commands: z.boolean(),
    max_fallback_attempts: z.number(),
    redact_secrets: z.boolean(),
    voice_requires_first_use_notice: z.boolean(),
    delete_temporary_audio_after_playback: z.boolean(),
  }),
});

export function loadConfigFromYaml(raw: string): JarvisConfig {
  const parsed = yamlSchema.parse(parseYaml(raw));
  const models: JarvisConfig["models"] = {};
  for (const [alias, m] of Object.entries(parsed.models)) {
    models[alias] = {
      provider: m.provider,
      adapter: m.adapter,
      envKey: m.env_key,
      auth: m.auth,
      fallback: m.fallback,
    };
  }

  return {
    version: parsed.version,
    mode: parsed.mode,
    defaultModel: parsed.default_model,
    models,
    voice: {
      provider: parsed.voice.provider,
      adapter: parsed.voice.adapter,
      envKey: parsed.voice.env_key,
      locale: parsed.voice.locale,
      voiceId: parsed.voice.voice_id,
      autoPlay: parsed.voice.auto_play,
      autoRead: parsed.voice.auto_read,
      audioFormat: parsed.voice.audio_format,
      keepAudio: parsed.voice.keep_audio,
      tempTtlSeconds: parsed.voice.temp_ttl_seconds,
      maxCharactersPerRequest: parsed.voice.max_characters_per_request,
      fallback: parsed.voice.fallback,
    },
    policies: {
      logContent: parsed.policies.log_content,
      requireConfirmationForCodeChanges:
        parsed.policies.require_confirmation_for_code_changes,
      requireConfirmationForNetworkOrDestructiveCommands:
        parsed.policies.require_confirmation_for_network_or_destructive_commands,
      maxFallbackAttempts: parsed.policies.max_fallback_attempts,
      redactSecrets: parsed.policies.redact_secrets,
      voiceRequiresFirstUseNotice: parsed.policies.voice_requires_first_use_notice,
      deleteTemporaryAudioAfterPlayback:
        parsed.policies.delete_temporary_audio_after_playback,
    },
  };
}

/** Client-safe mirror of config/models.yaml (parsed at build/test via loadConfigFromYaml). */
export const jarvisConfig: JarvisConfig = {
  version: 23,
  mode: "cloud-only",
  defaultModel: "gemini",
  models: {
    gemini: {
      provider: "google",
      adapter: "direct-api",
      envKey: "GEMINI_API_KEY",
      fallback: ["deepseek-flash"],
    },
    "deepseek-flash": {
      provider: "deepseek",
      adapter: "direct-api",
      envKey: "DEEPSEEK_API_KEY",
      fallback: ["gemini"],
    },
    "deepseek-pro": {
      provider: "deepseek",
      adapter: "direct-api",
      envKey: "DEEPSEEK_API_KEY",
      fallback: ["gemini"],
    },
    codex: {
      provider: "openai",
      adapter: "codex-cli",
      auth: "chatgpt-account-in-cursor",
      fallback: [],
    },
    "local-openai": {
      provider: "local",
      adapter: "openai-compatible",
      envKey: "LOCAL_OPENAI_BASE_URL",
      fallback: ["gemini"],
    },
  },
  voice: {
    provider: "minimax",
    adapter: "direct-api",
    envKey: "MINIMAX_API_KEY",
    locale: "pt-BR",
    voiceId: "natural-ptbr-default",
    autoPlay: true,
    autoRead: false,
    audioFormat: "mp3",
    keepAudio: false,
    tempTtlSeconds: 300,
    maxCharactersPerRequest: 3000,
    fallback: [],
  },
  policies: {
    logContent: false,
    requireConfirmationForCodeChanges: true,
    requireConfirmationForNetworkOrDestructiveCommands: true,
    maxFallbackAttempts: 1,
    redactSecrets: true,
    voiceRequiresFirstUseNotice: true,
    deleteTemporaryAudioAfterPlayback: true,
  },
};

export function listModelAliases(): string[] {
  return Object.keys(jarvisConfig.models);
}

export function getModelConfig(alias: string) {
  return jarvisConfig.models[alias];
}

export function getProviderForAlias(alias: string): string {
  return jarvisConfig.models[alias]?.provider ?? "unknown";
}
