import type { TextRequest, TextResponse, VoiceRequest, VoiceResponse } from "@/core/types";

export type MockFailure = "none" | "timeout" | "rate_limit" | "unavailable";

export interface TextAdapter {
  stream(request: TextRequest): AsyncGenerator<string, TextResponse>;
}

export interface VoiceAdapter {
  synthesize(request: VoiceRequest): Promise<VoiceResponse>;
}
