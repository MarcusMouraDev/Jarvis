import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeMemoryDb, setMemoryDbPathForTests } from "./memory-store";
import {
  createMemory,
  recallConsented,
  resetMemoryServiceForTests,
} from "./memory-service";

describe("memory-service", () => {
  beforeEach(() => {
    resetMemoryServiceForTests();
    setMemoryDbPathForTests(":memory:");
  });

  afterEach(() => {
    resetMemoryServiceForTests();
    setMemoryDbPathForTests(null);
    closeMemoryDb();
  });

  it("recallConsented retorna só consentidas e não expiradas", () => {
    createMemory({
      kind: "fact",
      content: "O usuário prefere TypeScript no projeto Jarvis",
      consent: true,
    });
    createMemory({
      kind: "fact",
      content: "Segredo sem consentimento sobre TypeScript",
      consent: false,
    });
    createMemory({
      kind: "fact",
      content: "Memória expirada sobre TypeScript",
      consent: true,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const recalled = recallConsented("TypeScript Jarvis");
    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.content).toContain("prefere TypeScript");
  });
});
