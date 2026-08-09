export function speakWithBrowser(
  text: string,
  options?: { locale?: string; signal?: AbortSignal },
): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return Promise.reject(new Error("speech_synthesis_unavailable"));
  }

  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options?.locale ?? "pt-BR";

    const cleanup = () => {
      options?.signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      window.speechSynthesis.cancel();
      cleanup();
      reject(new Error("aborted"));
    };

    if (options?.signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    options?.signal?.addEventListener("abort", onAbort, { once: true });

    utterance.onend = () => {
      cleanup();
      resolve();
    };
    utterance.onerror = () => {
      cleanup();
      reject(new Error("speech_synthesis_failed"));
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}
