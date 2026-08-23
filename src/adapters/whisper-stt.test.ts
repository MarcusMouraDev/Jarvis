import { describe, expect, it } from "vitest";
import { transcribeWithWhisper } from "./whisper-stt";

describe("transcribeWithWhisper", () => {
  it("envia áudio para a API Whisper", async () => {
    const blob = new Blob(["fake"], { type: "audio/webm" });
    const text = await transcribeWithWhisper(blob, {
      locale: "pt-BR",
      readEnv: (name) =>
        ({
          OPENAI_API_KEY: "test-key",
          WHISPER_MODEL: "whisper-1",
        })[name],
      fetchImpl: async (_url, init) => {
        const body = init?.body as FormData;
        expect(body.get("model")).toBe("whisper-1");
        expect(body.get("language")).toBe("pt");
        return {
          ok: true,
          json: async () => ({ text: "Olá Jarvis" }),
        } as Response;
      },
    });
    expect(text).toBe("Olá Jarvis");
  });

  it("falha sem chave", async () => {
    await expect(
      transcribeWithWhisper(new Blob([]), { readEnv: () => undefined }),
    ).rejects.toThrow("whisper_unavailable");
  });
});
