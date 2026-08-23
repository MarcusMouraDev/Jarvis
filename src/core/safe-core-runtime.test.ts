import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCoreStore, openCoreStore } from "./core-store";
import {
  buildSafeAdapters,
  createSafeCoreRuntime,
  listSecureWorkspaceNames,
} from "./safe-core-runtime";

const originalDataDir = process.env.JARVIS_DATA_DIR;

describe("safe-core runtime", () => {
  let root: string | null = null;

  afterEach(() => {
    closeCoreStore();
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
  });

  it("constructs only adapters with their required local/operator configuration", () => {
    const configured = buildSafeAdapters((name) =>
      ({
        JARVIS_LOCAL_MODEL: "qwen-local",
        GEMINI_API_KEY: "gemini-key",
        OPENAI_API_KEY: "openai-key",
        OPENAI_CODEX_MODEL: "gpt-codex",
        CURSOR_API_KEY: "cursor-key",
      })[name],
    );
    expect(Object.keys(configured).sort()).toEqual([
      "codex-openai",
      "cursor-text",
      "gemini",
      "local",
    ]);

    const localOnly = buildSafeAdapters((name) =>
      name === "JARVIS_LOCAL_MODEL" ? "qwen-local" : undefined,
    );
    expect(Object.keys(localOnly)).toEqual(["local"]);
    expect(localOnly.local?.model).toBe("qwen-local");
  });

  it("prefers OmniRoute OpenAI-compatible local over Ollama when both are set", () => {
    const adapters = buildSafeAdapters((name) =>
      ({
        LOCAL_OPENAI_BASE_URL: "http://127.0.0.1:20128",
        LOCAL_OPENAI_MODEL: "omni-model",
        JARVIS_LOCAL_MODEL: "qwen-local",
      })[name],
    );
    expect(Object.keys(adapters)).toEqual(["local"]);
    expect(adapters.local?.model).toBe("omni-model");
  });

  it("lists only real direct-child workspace directories without returning paths", () => {
    root = realpathSync(
      mkdtempSync(path.join(tmpdir(), "jarvis-runtime-workspaces-")),
    );
    mkdirSync(path.join(root, "valid-project"));
    writeFileSync(path.join(root, "regular-file"), "not a workspace");
    symlinkSync(path.join(root, "valid-project"), path.join(root, "linked-project"));

    expect(listSecureWorkspaceNames(root)).toEqual(["valid-project"]);
    expect(JSON.stringify(listSecureWorkspaceNames(root))).not.toContain(root);
  });

  it("composes store, catalog, gateway, orchestrator and service without a model call", () => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "jarvis-runtime-")));
    const dataDir = path.join(root, "data");
    const projectsRoot = path.join(root, "projects");
    mkdirSync(projectsRoot);
    process.env.JARVIS_DATA_DIR = dataDir;

    const runtime = createSafeCoreRuntime({
      store: openCoreStore(),
      projectsRoot,
      readEnv: (name) =>
        name === "JARVIS_LOCAL_MODEL"
          ? "qwen-local"
          : name === "JARVIS_MAX_BUDGET_USD"
            ? "0"
            : undefined,
    });

    expect(runtime.store).toBeDefined();
    expect(runtime.catalog.defaultModel).toBe("local");
    expect(runtime.gateway).toBeDefined();
    expect(runtime.orchestrator).toBeDefined();
    expect(runtime.service.listAgents()[0]?.id).toBe("Hermes");
  });
});
