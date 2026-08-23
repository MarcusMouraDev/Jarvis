"use client";

import type { AgentState } from "@/core/types";
import type { ReactNode } from "react";

interface PresenceStageProps {
  state: AgentState;
  compact?: boolean;
  children: ReactNode;
}

/** Atmospheric frame around the neural presence — shared by both shells. */
export function PresenceStage({ state, compact, children }: PresenceStageProps) {
  return (
    <div
      className={`presence-stage shrink-0${compact ? " presence-stage--compact" : ""}`}
      data-presence-state={state}
    >
      <div className="presence-atmosphere" aria-hidden>
        <div className="presence-atmosphere__aurora" />
        <div className="presence-atmosphere__stars" />
        <div className="presence-atmosphere__beams" />
        <div className="presence-atmosphere__grid" />
        <div className="presence-atmosphere__floor" />
        <div className="presence-atmosphere__pedestal" />
        <div className="presence-atmosphere__orbit presence-atmosphere__orbit--a" />
        <div className="presence-atmosphere__orbit presence-atmosphere__orbit--b" />
        <div className="presence-atmosphere__orbit presence-atmosphere__orbit--c" />
      </div>
      <div className="presence-halo" aria-hidden />
      <div className="presence-halo presence-halo--inner" aria-hidden />
      <div className="presence-stage__core">{children}</div>
    </div>
  );
}
