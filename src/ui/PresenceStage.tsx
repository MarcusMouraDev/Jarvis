"use client";

import type { AgentState } from "@/core/types";
import type { ReactNode } from "react";
import { Reticle } from "./hud/Reticle";
import { TelemetryRing } from "./hud/TelemetryRing";
import type { TelemetrySnapshot } from "./hud/telemetry-data";

interface PresenceStageProps {
  state: AgentState;
  compact?: boolean;
  telemetry?: TelemetrySnapshot;
  children: ReactNode;
}

/** Atmospheric frame around the neural presence — shared by both shells. */
export function PresenceStage({
  state,
  compact,
  telemetry,
  children,
}: PresenceStageProps) {
  return (
    <div
      className={`presence-stage shrink-0${compact ? " presence-stage--compact" : ""}`}
      data-presence-state={state}
    >
      <div className="presence-atmosphere" aria-hidden>
        <div className="presence-atmosphere__floor" />
        <div className="presence-atmosphere__pedestal" />
      </div>
      <div key={state} className="presence-stage__flash" aria-hidden />
      <div className="presence-halo" aria-hidden />
      <div className="presence-halo presence-halo--inner" aria-hidden />
      {telemetry ? (
        <>
          <TelemetryRing snapshot={telemetry} />
          <Reticle />
        </>
      ) : null}
      <div className="presence-stage__core">{children}</div>
    </div>
  );
}
