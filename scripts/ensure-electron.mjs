#!/usr/bin/env node
/**
 * Electron postinstall can skip extraction when ELECTRON_RUN_AS_NODE is set.
 * path.txt may also contain a trailing newline, which breaks spawn (ENOENT).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronDir = join(root, "node_modules", "electron");
const pathFile = join(electronDir, "path.txt");

function trimPathTxt() {
  if (!existsSync(pathFile)) return;
  const rel = readFileSync(pathFile, "utf8").trim();
  if (!rel) return;
  writeFileSync(pathFile, rel, "utf8");
}

function electronBinary() {
  if (!existsSync(pathFile)) return null;
  const rel = readFileSync(pathFile, "utf8").trim();
  return join(electronDir, "dist", rel);
}

trimPathTxt();

const binary = electronBinary();
if (binary && existsSync(binary)) {
  process.exit(0);
}

const installJs = join(electronDir, "install.js");
if (!existsSync(installJs)) {
  console.error("ensure-electron: electron not installed (missing install.js)");
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const result = spawnSync(process.execPath, [installJs], {
  cwd: electronDir,
  env,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

trimPathTxt();

const after = electronBinary();
if (!after || !existsSync(after)) {
  console.error("ensure-electron: binary still missing after install.js");
  process.exit(1);
}
