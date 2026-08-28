import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadAgentCatalogFromDisk, type AgentCatalog } from "./agent-catalog";
import type { CoreStore } from "./core-store";
import { getCoreStore } from "./core-store-runtime";
import {
  CodexOpenAIAdapter,
  CursorTextSafeAdapter,
  GeminiSafeAdapter,
  LocalOllamaAdapter,
  LocalOpenAICompatibleAdapter,
  type SafeModelAdapter,
} from "./safe-model-adapters";
import {
  SafeCoreService,
  type SafeCoreOrchestratorPort,
  type SafeCoreToolGatewayPort,
} from "./safe-core-service";
import { SafeModelOrchestrator } from "./safe-orchestrator";
import { SafeToolGateway } from "./tool-gateway";
import { getHermesBridge } from "@/integrations/hermes/bridge";
import { resolveWorkspace } from "./workspace-policy";

type ReadEnv = (name: string) => string | undefined;
type AdapterMap = Partial<
  Record<SafeModelAdapter["alias"], SafeModelAdapter>
>;

export interface SafeCoreRuntime {
  store: CoreStore;
  catalog: AgentCatalog;
  gateway: SafeCoreToolGatewayPort;
  orchestrator: SafeCoreOrchestratorPort;
  service: SafeCoreService;
}

export interface CreateSafeCoreRuntimeOptions {
  store?: CoreStore;
  catalog?: AgentCatalog;
  projectsRoot?: string;
  readEnv?: ReadEnv;
}

function processEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function positiveNumber(
  readEnv: ReadEnv,
  name: string,
  fallback: number,
  options: { allowZero?: boolean } = {},
): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const value = Number(raw);
  const valid =
    Number.isFinite(value) &&
    (options.allowZero ? value >= 0 : value > 0);
  if (!valid) throw new Error(`invalid_env:${name}`);
  return value;
}

export function buildSafeAdapters(readEnv: ReadEnv = processEnv): AdapterMap {
  const adapters: AdapterMap = {};
  // OmniRoute (OpenAI-compatible) wins over Ollama for alias `local`.
  if (readEnv("LOCAL_OPENAI_BASE_URL")?.trim()) {
    adapters.local = new LocalOpenAICompatibleAdapter({ readEnv });
  } else if (readEnv("JARVIS_LOCAL_MODEL")) {
    adapters.local = new LocalOllamaAdapter({ readEnv });
  }
  if (readEnv("GEMINI_API_KEY")) {
    adapters.gemini = new GeminiSafeAdapter({ readEnv });
  }
  if (readEnv("OPENAI_API_KEY") && readEnv("OPENAI_CODEX_MODEL")) {
    adapters["codex-openai"] = new CodexOpenAIAdapter({ readEnv });
  }
  if (readEnv("CURSOR_API_KEY")) {
    adapters["cursor-text"] = new CursorTextSafeAdapter({ readEnv });
  }
  return adapters;
}

export function listSecureWorkspaceNames(projectsRoot: string): string[] {
  let entries;
  try {
    entries = readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.name),
    )
    .flatMap((entry) => {
      try {
        resolveWorkspace(
          { kind: "existing", path: entry.name },
          { projectsRoot },
        );
        return [entry.name];
      } catch {
        return [];
      }
    })
    .sort((left, right) => left.localeCompare(right));
}

export function createSafeCoreRuntime(
  options: CreateSafeCoreRuntimeOptions = {},
): SafeCoreRuntime {
  const readEnv = options.readEnv ?? processEnv;
  const projectsRoot =
    options.projectsRoot ??
    readEnv("JARVIS_PROJECTS_ROOT") ??
    join(homedir(), "Projetos");
  const store = options.store ?? getCoreStore();
  const catalog = options.catalog ?? loadAgentCatalogFromDisk();
  const gateway = new SafeToolGateway({ store, catalog });
  const orchestrator = new SafeModelOrchestrator({
    store,
    catalog,
    adapters: buildSafeAdapters(readEnv),
    toolGateway: gateway,
    serverMaxTimeoutMs: positiveNumber(
      readEnv,
      "JARVIS_MAX_RUN_TIMEOUT_MS",
      300_000,
    ),
    serverMaxBudgetUsd: positiveNumber(
      readEnv,
      "JARVIS_MAX_BUDGET_USD",
      0,
      { allowZero: true },
    ),
  });
  const hermes =
    process.env.NODE_ENV === "test" &&
    !readEnv("HERMES_GATEWAY_URL") &&
    !readEnv("HERMES_BRIDGE")
      ? undefined
      : getHermesBridge(store);
  const service = new SafeCoreService({
    store,
    catalog,
    orchestrator,
    projectsRoot,
    listWorkspaceNames: () => listSecureWorkspaceNames(projectsRoot),
    toolGateway: gateway,
    hermes,
  });
  return { store, catalog, gateway, orchestrator, service };
}

let activeRuntime: SafeCoreRuntime | null = null;

export function getSafeCoreRuntime(): SafeCoreRuntime {
  activeRuntime ??= createSafeCoreRuntime();
  return activeRuntime;
}

/** Narrow route-handler seam; production callers cannot install a fake runtime. */
export function setSafeCoreRuntimeForTests(runtime: SafeCoreRuntime): void {
  if (process.env.NODE_ENV !== "test") throw new Error("test_runtime_forbidden");
  activeRuntime = runtime;
}

export function resetSafeCoreRuntimeForTests(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("test_runtime_forbidden");
  activeRuntime = null;
}
