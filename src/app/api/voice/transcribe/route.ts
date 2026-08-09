import { NextResponse } from "next/server";
import { transcribeWithWhisper } from "@/adapters/whisper-stt";
import { jarvisConfig } from "@/core/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "audio_required" }, { status: 400 });
  }

  const maxBytes = Number(process.env.WHISPER_MAX_BYTES ?? "25000000");
  if (audio.size > maxBytes) {
    return NextResponse.json({ error: "audio_too_large" }, { status: 413 });
  }

  try {
    const text = await transcribeWithWhisper(audio, {
      locale: jarvisConfig.voice.locale,
    });
    return NextResponse.json({ provider: "whisper", text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "transcribe_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
