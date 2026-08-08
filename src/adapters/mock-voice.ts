import type { VoiceAdapter } from "./base";
import type { VoiceRequest, VoiceResponse } from "@/core/types";

export class MockVoiceAdapter implements VoiceAdapter {
  constructor(private readonly shouldFail = false) {}

  async synthesize(request: VoiceRequest): Promise<VoiceResponse> {
    if (this.shouldFail) {
      throw new Error("minimax_unavailable");
    }

    return {
      voiceId: request.voiceId,
      locale: request.locale,
      audioFormat: request.audioFormat,
      audioPath: "/mock-speech.mp3",
      requestId: request.requestId,
      characters: request.text.length,
    };
  }
}
