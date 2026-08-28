import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TelegramStore } from "./telegram-store";

describe("TelegramStore", () => {
  let root: string;
  let store: TelegramStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jarvis-telegram-"));
    store = new TelegramStore(root);
  });

  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("links a private user with a one-time code and unlinks immediately", () => {
    const code = store.createLinkCode("marcus@example.com");
    const link = store.redeemLinkCode(code.code, { telegramUserId: "42", chatId: "42" });
    expect(link.identityLogin).toBe("marcus@example.com");
    expect(() =>
      store.redeemLinkCode(code.code, { telegramUserId: "43", chatId: "43" }),
    ).toThrow("telegram_link_code_invalid");
    expect(store.getAuthorizedChat("42")?.chatId).toBe("42");
    store.unlink("42");
    expect(store.getAuthorizedChat("42")).toBeNull();
  });

  it("claims updates and callbacks idempotently", () => {
    expect(store.claimUpdate(10)).toBe(true);
    expect(store.claimUpdate(10)).toBe(false);
    expect(store.claimCallback("callback-1")).toBe(true);
    expect(store.claimCallback("callback-1")).toBe(false);
    expect(store.nextUpdateOffset()).toBe(11);
  });

  it("releases failed work so long polling can retry it", () => {
    expect(store.claimUpdate(20)).toBe(true);
    store.releaseUpdate(20);
    expect(store.claimUpdate(20)).toBe(true);
    expect(store.claimCallback("retry-me")).toBe(true);
    store.releaseCallback("retry-me");
    expect(store.claimCallback("retry-me")).toBe(true);
  });
});
