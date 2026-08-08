import { lstatSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspace } from "./workspace-policy";

const tempPaths: string[] = [];

function projectsRoot() {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "jarvis-workspace-"));
  tempPaths.push(temporaryRoot);
  return realpathSync(temporaryRoot);
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("workspace policy", () => {
  it("freezes a real existing workspace under the projects root", () => {
    const root = projectsRoot();
    const workspace = join(root, "repo");
    mkdirSync(workspace);

    const resolved = resolveWorkspace(
      { kind: "existing", path: workspace },
      { projectsRoot: root },
    );

    expect(resolved).toEqual({ kind: "existing", path: realpathSync(workspace) });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it.each([
    ["traversal", (root: string) => ({ kind: "existing" as const, path: join(root, "repo", "..", "other") })],
    ["missing directory", (root: string) => ({ kind: "existing" as const, path: join(root, "missing") })],
  ])("rejects an existing workspace with %s", (_name, inputFor) => {
    const root = projectsRoot();

    expect(() => resolveWorkspace(inputFor(root), { projectsRoot: root })).toThrow();
  });

  it("rejects symlinks at the root and supplied workspace components", () => {
    const parent = projectsRoot();
    const root = join(parent, "projects");
    const realRoot = join(parent, "real-projects");
    mkdirSync(root);
    mkdirSync(realRoot);
    mkdirSync(join(realRoot, "repo"));
    symlinkSync(realRoot, join(parent, "linked-projects"));
    symlinkSync(join(realRoot, "repo"), join(root, "linked-repo"));

    expect(() =>
      resolveWorkspace(
        { kind: "existing", path: join(parent, "linked-projects", "repo") },
        { projectsRoot: join(parent, "linked-projects") },
      ),
    ).toThrow();
    expect(() =>
      resolveWorkspace(
        { kind: "existing", path: join(root, "linked-repo") },
        { projectsRoot: root },
      ),
    ).toThrow();
  });

  it("rejects a projects root reached through an ancestor symlink", () => {
    const parent = projectsRoot();
    const realParent = join(parent, "real-parent");
    const realRoot = join(realParent, "projects");
    mkdirSync(realRoot, { recursive: true });
    mkdirSync(join(realRoot, "repo"));
    symlinkSync(realParent, join(parent, "linked-parent"));
    const linkedRoot = join(parent, "linked-parent", "projects");

    expect(() =>
      resolveWorkspace(
        { kind: "existing", path: join(linkedRoot, "repo") },
        { projectsRoot: linkedRoot },
      ),
    ).toThrow();
  });

  it("requires a new workspace to be a valid non-existing direct child", () => {
    const root = projectsRoot();
    mkdirSync(join(root, "taken"));

    expect(resolveWorkspace({ kind: "new", name: "new-app" }, { projectsRoot: root })).toEqual({
      kind: "new",
      name: "new-app",
      path: join(realpathSync(root), "new-app"),
    });
    expect(() =>
      resolveWorkspace({ kind: "new", name: "nested/app" }, { projectsRoot: root }),
    ).toThrow();
    expect(() =>
      resolveWorkspace({ kind: "new", name: "taken" }, { projectsRoot: root }),
    ).toThrow();
  });

  it("fails closed when checking a new workspace encounters a filesystem error", () => {
    const root = projectsRoot();

    expect(() =>
      resolveWorkspace(
        { kind: "new", name: "new-app" },
        {
          projectsRoot: root,
          lstat: ((path) => {
            if (path === join(realpathSync(root), "new-app")) {
              const error = new Error("permission denied") as NodeJS.ErrnoException;
              error.code = "EACCES";
              throw error;
            }
            return lstatSync(path);
          }) as typeof lstatSync,
        },
      ),
    ).toThrow();
  });
});
