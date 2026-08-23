"use client";

import { useEffect, useRef } from "react";
import { rmsFromTimeDomain } from "./clap-detector";
import { queryMicPermission, requestMicPermission } from "./mic-permission";

const SILENCE_MS = 1200;
const MIN_SPEECH_MS = 400;
const MAX_RECORD_MS = 30_000;

export function useVoiceListen(options: {
  active: boolean;
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const { active, onTranscript, onError } = options;
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const levelRef = useRef(0);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onError;
  }, [onTranscript, onError]);

  useEffect(() => {
    if (!active) {
      levelRef.current = 0;
      return;
    }

    let cancelled = false;
    let raf = 0;
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    let speechStartedAt: number | null = null;
    let lastVoiceAt = 0;
    let timeDomain: Float32Array<ArrayBuffer> | null = null;

    const stopAll = () => {
      cancelAnimationFrame(raf);
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close();
      levelRef.current = 0;
    };

    const upload = async () => {
      if (!chunks.length || cancelled) return;
      const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
      try {
        const form = new FormData();
        form.append("audio", blob, "speech.webm");
        const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "transcribe_failed");
        }
        const payload = (await res.json()) as { text?: string };
        if (payload.text?.trim()) onTranscriptRef.current(payload.text.trim());
      } catch (err) {
        const message = err instanceof Error ? err.message : "transcribe_failed";
        onErrorRef.current?.(message);
      }
    };

    void (async () => {
      const perm = await queryMicPermission();
      if (perm === "denied" || cancelled) return;
      const granted = perm === "granted" ? perm : await requestMicPermission();
      if (granted !== "granted" || cancelled) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return;

        context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        timeDomain = new Float32Array(analyser.fftSize);

        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          void upload();
        };
        recorder.start(250);

        const startedAt = performance.now();
        const speechThreshold = 0.015;

        const tick = () => {
          if (cancelled || !analyser || !timeDomain || !recorder) return;
          analyser.getFloatTimeDomainData(timeDomain);
          const energy = rmsFromTimeDomain(timeDomain);
          levelRef.current = Math.min(1, energy * 12);
          const now = performance.now();

          if (energy > speechThreshold) {
            if (speechStartedAt === null) speechStartedAt = now;
            lastVoiceAt = now;
          }

          const spokeLongEnough =
            speechStartedAt !== null && now - speechStartedAt >= MIN_SPEECH_MS;
          const silentLongEnough =
            speechStartedAt !== null && now - lastVoiceAt >= SILENCE_MS;
          const timedOut = now - startedAt >= MAX_RECORD_MS;

          if (spokeLongEnough && (silentLongEnough || timedOut)) {
            recorder.stop();
            return;
          }

          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        onErrorRef.current?.("mic_unavailable");
      }
    })();

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [active]);

  return { levelRef };
}
