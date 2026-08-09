"use client";

import { useEffect, useRef } from "react";
import type { MicPermission, PrivacyClass } from "@/core/types";
import { MIC_PERMISSION_LABELS } from "@/audio/mic-permission";

interface InstrumentBarProps {
  privacyClass: PrivacyClass;
  profile: string;
  modelAlias: string;
  provider: string;
  spentUsd: number;
  budgetUsd: number;
  voiceOn: boolean;
  clapWakeOn: boolean;
  micPermission: MicPermission;
  onHeightChange?: (height: number) => void;
}

function formatUsd(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
  });
}

export function InstrumentBar({
  privacyClass,
  profile,
  modelAlias,
  provider,
  spentUsd,
  budgetUsd,
  voiceOn,
  clapWakeOn,
  micPermission,
  onHeightChange,
}: InstrumentBarProps) {
  const ref = useRef<HTMLElement>(null);
  const micShort =
    micPermission === "granted"
      ? "mic:ok"
      : micPermission === "denied"
        ? "mic:off"
        : "mic:?";

  useEffect(() => {
    if (!ref.current || !onHeightChange) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? el.offsetHeight;
      onHeightChange(h);
    });
    ro.observe(el);
    onHeightChange(el.offsetHeight);
    return () => ro.disconnect();
  }, [onHeightChange]);

  return (
    <header
      ref={ref}
      className="chrome-z shrink-0 border-b border-surface-2/80 bg-surface-0/90 px-3 py-2 text-[11px] font-mono text-ink-2 backdrop-blur-sm sm:px-4 sm:text-xs"
    >
      <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="whitespace-nowrap text-ink-1">{privacyClass}</span>
          <span className="text-surface-2" aria-hidden>
            ·
          </span>
          <span className="whitespace-nowrap text-ink-1">{profile}</span>
          <span className="text-surface-2" aria-hidden>
            ·
          </span>
          <span className="truncate md:hidden">{micShort}</span>
          <span className="hidden truncate md:inline">
            {MIC_PERMISSION_LABELS[micPermission]}
          </span>
        </div>
        <div className="min-w-0 justify-self-end truncate text-ink-1 md:justify-self-center">
          <span className="whitespace-nowrap">{modelAlias}</span>
          <span className="text-ink-2"> · {provider}</span>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 md:col-span-1 md:justify-self-end">
          <span className="whitespace-nowrap">
            {formatUsd(spentUsd)} / {formatUsd(budgetUsd)}
          </span>
          <span className="whitespace-nowrap">{voiceOn ? "voz:on" : "voz:off"}</span>
          <span className="whitespace-nowrap">{clapWakeOn ? "palmas:on" : "palmas:off"}</span>
        </div>
      </div>
    </header>
  );
}
