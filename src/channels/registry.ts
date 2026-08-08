import type { ChannelAdapter } from "./types";
import { webChannelAdapter } from "./web-adapter";

const adapters = new Map<string, ChannelAdapter>();

function register(adapter: ChannelAdapter) {
  adapters.set(adapter.id, adapter);
}

register(webChannelAdapter);

export function getChannel(id: string): ChannelAdapter | null {
  return adapters.get(id) ?? null;
}

export function listChannels(): ChannelAdapter[] {
  return [...adapters.values()];
}

export function listAvailableChannels(): ChannelAdapter[] {
  return listChannels().filter((c) => c.isAvailable());
}

/** Test helper */
export function clearChannelRegistry() {
  adapters.clear();
  register(webChannelAdapter);
}
