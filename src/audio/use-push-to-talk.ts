"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PushToTalkOptions {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function usePushToTalk({ onTranscript, disabled }: PushToTalkOptions) {
  const [listening, setListening] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    if (disabled || listening) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      if (blob.size === 0) return;
      const body = new FormData();
      body.append("audio", blob, "speech.webm");
      void fetch("/api/voice/transcribe", { method: "POST", body })
        .then((response) => response.json())
        .then((payload: { text?: string }) => {
          if (payload.text) onTranscript(payload.text);
        })
        .catch(() => undefined);
    };
    recorderRef.current = recorder;
    recorder.start();
    setListening(true);
  }, [disabled, listening, onTranscript]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code !== "KeyV") return;
      if (event.type === "keydown") void start();
      if (event.type === "keyup") stop();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [start, stop]);

  useEffect(() => () => stop(), [stop]);

  return { listening, start, stop };
}
