"use client";

import type { ReactNode } from "react";
import type { TelemetrySnapshot } from "./telemetry-data";

export function HudFrame({
  snapshot,
  children,
}: {
  snapshot: TelemetrySnapshot;
  children?: ReactNode;
}) {
  const legend = snapshot.readouts.filter(
    (row) => row.id !== "status" && row.id !== "state",
  );

  return (
    <div className="hud-frame">
      <div className="hud-frame__stage">
        <div className="hud-brackets" aria-hidden>
          <span className="hud-bracket hud-bracket--tl" />
          <span className="hud-bracket hud-bracket--tr" />
          <span className="hud-bracket hud-bracket--bl" />
          <span className="hud-bracket hud-bracket--br" />
          <span className="hud-scan" />
        </div>
        {children}
      </div>
      <dl
        className="hud-readouts hud-mono"
        data-online={snapshot.online ? "true" : "false"}
      >
        {legend.map((row) => (
          <div key={row.id} className="hud-readout">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
