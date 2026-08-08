import type { TextRequest, TextResponse, VoiceRequest, VoiceResponse } from "@/core/types";

export type MockFailure = "none" | "timeout" | "rate_limit" | "unavailable";

export interface StreamOptions {
  systemInstruction?: string;
}

export interface TextAdapter {
  stream(
    request: TextRequest,
    options?: StreamOptions,
  ): AsyncGenerator<string, TextResponse>;
}

export interface VoiceAdapter {
  synthesize(request: VoiceRequest): Promise<VoiceResponse>;
}
