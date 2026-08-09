type ReadEnv = (name: string) => string | undefined;

export interface WhisperTranscribeOptions {
  readEnv?: ReadEnv;
  fetchImpl?: typeof fetch;
  locale?: string;
}

function resolveApiKey(readEnv: ReadEnv): string | undefined {
  return readEnv("OPENAI_API_KEY") ?? readEnv("WHISPER_API_KEY");
}

function resolveBaseUrl(readEnv: ReadEnv): string {
  return (
    readEnv("WHISPER_API_BASE") ??
    readEnv("OPENAI_API_BASE") ??
    "https://api.openai.com"
  ).replace(/\/$/, "");
}

function localeToWhisperLanguage(locale: string): string | undefined {
  const tag = locale.toLowerCase();
  if (tag.startsWith("pt")) return "pt";
  if (tag.startsWith("en")) return "en";
  if (tag.startsWith("es")) return "es";
  return undefined;
}

export async function transcribeWithWhisper(
  audio: Blob,
  options: WhisperTranscribeOptions = {},
): Promise<string> {
  const readEnv = options.readEnv ?? ((name) => process.env[name]?.trim() || undefined);
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = resolveApiKey(readEnv);
  if (!apiKey) throw new Error("whisper_unavailable");

  const model = readEnv("WHISPER_MODEL") ?? "whisper-1";
  const language = localeToWhisperLanguage(options.locale ?? readEnv("WHISPER_LOCALE") ?? "pt-BR");

  const form = new FormData();
  const ext = audio.type.includes("webm") ? "webm" : audio.type.includes("wav") ? "wav" : "audio";
  form.append("file", audio, `speech.${ext}`);
  form.append("model", model);
  if (language) form.append("language", language);

  const response = await fetchImpl(`${resolveBaseUrl(readEnv)}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`whisper_http_${response.status}`);
  }

  const payload = (await response.json()) as { text?: string };
  const text = payload.text?.trim();
  if (!text) throw new Error("whisper_empty");
  return text;
}
