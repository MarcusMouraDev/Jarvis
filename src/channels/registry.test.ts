import { describe, expect, it } from "vitest";
import { listAvailableChannels, listChannels } from "./registry";

describe("channel-registry", () => {
  it("lista web como canal registrado", () => {
    const channels = listChannels();
    const ids = channels.map((c) => c.id);
    expect(ids).toContain("web");
  });

  it("web está disponível em ambiente de teste", () => {
    const available = listAvailableChannels();
    expect(available.some((c) => c.id === "web")).toBe(true);
  });
});
