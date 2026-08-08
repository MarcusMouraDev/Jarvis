import { lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

const workspaceRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("existing"), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("new"), name: z.string().min(1) }).strict(),
]);

const newWorkspaceName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type WorkspaceRequest = z.infer<typeof workspaceRequestSchema>;
export type ResolvedWorkspace =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "existing"; path: string }>
  | Readonly<{ kind: "new"; name: string; path: string }>;

export interface WorkspaceResolverOptions {
  projectsRoot?: string;
}

function fail(message: string): never {
  throw new Error(`Invalid workspace: ${message}`);
}

function getConfiguredProjectsRoot(options: WorkspaceResolverOptions): string {
  return options.projectsRoot || process.env.JARVIS_PROJECTS_ROOT || join(homedir(), "Projetos");
}

function hasTraversal(value: string): boolean {
  return value.split(/[\\/]+/).includes("..");
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== "" && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot);
}

function resolveProjectsRoot(options: WorkspaceResolverOptions): {
  supplied: string;
  real: string;
} {
  const configuredRoot = getConfiguredProjectsRoot(options);
  if (hasTraversal(configuredRoot)) fail("projects root traversal");

  let rootStatus;
  try {
    rootStatus = lstatSync(configuredRoot);
  } catch {
    fail("projects root does not exist");
  }
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    fail("projects root must be a real directory");
  }

  return { supplied: resolve(configuredRoot), real: realpathSync(configuredRoot) };
}

function assertRealExistingWorkspace(
  root: { supplied: string; real: string },
  suppliedPath: string,
): string {
  if (hasTraversal(suppliedPath)) fail("workspace traversal");

  const candidate = resolve(
    isAbsolute(suppliedPath) ? suppliedPath : join(root.supplied, suppliedPath),
  );
  if (!isContained(root.supplied, candidate)) fail("workspace escapes projects root");

  const components = relative(root.supplied, candidate).split(sep);
  let current = root.supplied;
  for (const component of components) {
    current = join(current, component);
    let status;
    try {
      status = lstatSync(current);
    } catch {
      fail("workspace does not exist");
    }
    if (status.isSymbolicLink()) fail("workspace contains a symlink");
  }

  if (!statSync(candidate).isDirectory()) fail("workspace must be a directory");
  const realCandidate = realpathSync(candidate);
  if (!isContained(root.real, realCandidate)) fail("workspace escapes projects root after realpath");
  return realCandidate;
}

/** Resolves and freezes the workspace once, before a safe-core run starts. */
export function resolveWorkspace(
  input: WorkspaceRequest,
  options: WorkspaceResolverOptions = {},
): ResolvedWorkspace {
  const workspace = workspaceRequestSchema.parse(input);
  if (workspace.kind === "none") return Object.freeze({ kind: "none" as const });

  const root = resolveProjectsRoot(options);
  if (workspace.kind === "existing") {
    return Object.freeze({
      kind: "existing" as const,
      path: assertRealExistingWorkspace(root, workspace.path),
    });
  }

  if (!newWorkspaceName.test(workspace.name)) fail("new workspace name");
  const candidate = join(root.real, workspace.name);
  try {
    lstatSync(candidate);
    fail("new workspace already exists");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid workspace:")) throw error;
  }

  return Object.freeze({ kind: "new" as const, name: workspace.name, path: candidate });
}
