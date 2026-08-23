"use client";

import type { TelemetrySnapshot } from "./telemetry-data";

export function HudFrame({ snapshot }: { snapshot: TelemetrySnapshot }) {
  return (
    <>
      <div className="hud-brackets" aria-hidden>
        <span className="hud-bracket hud-bracket--tl" />
        <span className="hud-bracket hud-bracket--tr" />
        <span className="hud-bracket hud-bracket--bl" />
        <span className="hud-bracket hud-bracket--br" />
        <span className="hud-scan" />
      </div>
      <dl
        className="hud-readouts hud-mono"
        data-online={snapshot.online ? "true" : "false"}
      >
        {snapshot.readouts.map((r) => (
          <div key={r.id} className="hud-readout">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
