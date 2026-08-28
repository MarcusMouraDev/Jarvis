import { openCoreStore, type CoreStore } from "./core-store";

/**
 * Minimal runtime boundary for routes that need persistence/authentication but
 * must not initialize the agent catalog, model adapters, or tool gateway.
 */
export function getCoreStore(): CoreStore {
  return openCoreStore();
}
