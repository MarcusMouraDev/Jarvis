"use client";

import { useEffect, useRef } from "react";
import type { PrivacyClass } from "@/core/types";

interface SafeInstrumentBarProps {
  agentId: string;
  privacyClass: PrivacyClass;
  model: { provider: string; model: string } | null;
  status: string | null;
  onHeightChange?: (height: number) => void;
}

export function SafeInstrumentBar({
  agentId,
  privacyClass,
  model,
  status,
  onHeightChange,
}: SafeInstrumentBarProps) {
  const ref = useRef<HTMLElement>(null);

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
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2">
          <span className="text-ink-1">{privacyClass}</span>
          <span className="text-surface-2" aria-hidden>
            ·
          </span>
          <span className="truncate text-ink-1">{agentId}</span>
        </div>
        <div className="min-w-0 truncate text-ink-1">
          {model ? (
            <>
              <span>{model.model}</span>
              <span className="text-ink-2"> · {model.provider}</span>
            </>
          ) : (
            <span>modelo pendente</span>
          )}
        </div>
        <div className="whitespace-nowrap text-ink-1">{status ?? "idle"}</div>
      </div>
    </header>
  );
}
