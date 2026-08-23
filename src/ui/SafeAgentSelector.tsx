"use client";

import type { SafeAgentId, SafeAgentSummary } from "@/core/safe-api-contract";

interface SafeAgentSelectorProps {
  agents: SafeAgentSummary[];
  value: SafeAgentId;
  runIsActive: boolean;
  onChange: (agentId: SafeAgentId) => void;
}

const FALLBACK_AGENTS: SafeAgentId[] = ["Hermes", "Planner", "Developer", "Builder"];

export function SafeAgentSelector({
  agents,
  value,
  runIsActive,
  onChange,
}: SafeAgentSelectorProps) {
  const options =
    agents.length > 0 ? agents.map((agent) => agent.id) : FALLBACK_AGENTS;

  return (
    <label className="safe-agent-selector flex w-full max-w-[65ch] flex-col gap-1 text-left text-xs text-ink-2">
      <span className="font-mono uppercase tracking-wide">Agente</span>
      <select
        className="rounded-md border border-surface-2/80 bg-surface-1/90 px-2 py-2 text-sm text-ink-0 outline-none focus-visible:border-[color-mix(in_oklab,var(--focus-ring)_50%,var(--color-border))] focus-visible:ring-1 focus-visible:ring-[color-mix(in_oklab,var(--focus-ring)_35%,transparent)]"
        value={value}
        disabled={runIsActive}
        aria-label="Selecionar agente"
        onChange={(event) => onChange(event.target.value as SafeAgentId)}
      >
        {options.map((agentId) => (
          <option key={agentId} value={agentId}>
            {agentId === "Hermes" ? "Hermes (padrão)" : agentId}
          </option>
        ))}
      </select>
    </label>
  );
}
