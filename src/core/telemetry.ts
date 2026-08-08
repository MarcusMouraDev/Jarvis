import type { TelemetryEvent } from "./types";

const events: TelemetryEvent[] = [];

export function recordTelemetry(event: TelemetryEvent) {
  if (process.env.NODE_ENV !== "production") {
    events.push(event);
  }
}

export function getTelemetryEvents(): TelemetryEvent[] {
  return [...events];
}

export function clearTelemetry() {
  events.length = 0;
}
