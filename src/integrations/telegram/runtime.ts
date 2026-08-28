import path from "node:path";
import { getJarvisDataDir } from "@/core/data-dir";
import { TelegramStore } from "./telegram-store";

let store: TelegramStore | null = null;
export function getTelegramStore(): TelegramStore {
  if (!store) store = new TelegramStore(path.join(getJarvisDataDir(), "telegram"));
  return store;
}
export function resetTelegramStoreForTests(): void {
  store?.close();
  store = null;
}
