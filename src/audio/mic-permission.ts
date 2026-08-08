import type { MicPermission } from "@/core/types";

export async function queryMicPermission(): Promise<MicPermission> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unavailable";
  }

  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      if (status.state === "granted") return "granted";
      if (status.state === "denied") return "denied";
      return "unknown";
    }
  } catch {
    // Permissions API may reject microphone on some browsers.
  }

  return "unknown";
}

export async function requestMicPermission(): Promise<MicPermission> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unavailable";
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "denied";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "unavailable";
    }
    return "denied";
  }
}

export const MIC_PERMISSION_LABELS: Record<MicPermission, string> = {
  unknown: "mic: não pedido",
  prompting: "mic: pedindo…",
  granted: "mic: concedido",
  denied: "mic: negado",
  unavailable: "mic: indisponível",
};
