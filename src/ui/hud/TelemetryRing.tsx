"use client";

import type { TelemetrySnapshot } from "./telemetry-data";

const RADII: Record<string, number> = { quota: 46, stream: 42 };
const CIRC = (r: number) => 2 * Math.PI * r;

export function TelemetryRing({ snapshot }: { snapshot: TelemetrySnapshot }) {
  return (
    <svg
      className="telemetry-ring"
      viewBox="0 0 100 100"
      aria-hidden
      focusable="false"
    >
      {Array.from({ length: 60 }, (_, i) => {
        const long = i % 5 === 0;
        return (
          <line
            key={i}
            x1="50"
            y1={long ? 2.5 : 3.5}
            x2="50"
            y2="5.5"
            className={
              long ? "telemetry-tick telemetry-tick--major" : "telemetry-tick"
            }
            transform={`rotate(${i * 6} 50 50)`}
          />
        );
      })}
      {snapshot.gauges.map((g) => {
        const r = RADII[g.id] ?? 44;
        const c = CIRC(r);
        const filled = g.value === null ? 0 : g.value * c * 0.75;
        return (
          <g key={g.id} transform="rotate(-90 50 50)">
            <circle
              cx="50"
              cy="50"
              r={r}
              className="telemetry-track"
              strokeDasharray={`${c * 0.75} ${c}`}
            />
            {g.value === null ? null : (
              <circle
                cx="50"
                cy="50"
                r={r}
                className="telemetry-arc"
                strokeDasharray={`${filled} ${c}`}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
