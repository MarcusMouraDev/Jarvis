"use client";

import type { MicPermission, PrivacyClass } from "@/core/types";
import { MIC_PERMISSION_LABELS } from "@/audio/mic-permission";

interface InstrumentBarProps {
  privacyClass: PrivacyClass;
  modelAlias: string;
  provider: string;
  spentUsd: number;
  budgetUsd: number;
  voiceOn: boolean;
  micPermission: MicPermission;
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
  modelAlias,
  provider,
  spentUsd,
  budgetUsd,
  voiceOn,
  micPermission,
}: InstrumentBarProps) {
  return (
    <header className="grid grid-cols-3 items-center border-b border-surface-2 px-4 py-3 text-xs font-mono text-ink-2">
      <div className="justify-self-start">
        <span className="text-ink-1">{privacyClass}</span>
        <span className="mx-2 text-surface-2">·</span>
        <span>{MIC_PERMISSION_LABELS[micPermission]}</span>
      </div>
      <div className="justify-self-center text-ink-1">
        {modelAlias} <span className="text-ink-2">· {provider}</span>
      </div>
      <div className="justify-self-end flex gap-3">
        <span>
          {formatUsd(spentUsd)} / {formatUsd(budgetUsd)}
        </span>
        <span>{voiceOn ? "voz:on" : "voz:off"}</span>
      </div>
    </header>
  );
}
