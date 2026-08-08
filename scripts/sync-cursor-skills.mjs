#!/usr/bin/env node
/**
 * Espelha as skills oficiais do Cursor (~/.cursor/skills-cursor e ~/.cursor/skills)
 * em .cursor/skills do projeto via symlinks, para o IDE e o runtime local.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const targetRoot = join(projectRoot, ".cursor", "skills");
const sources = [
  join(homedir(), ".cursor", "skills-cursor"),
  join(homedir(), ".cursor", "skills"),
];

mkdirSync(targetRoot, { recursive: true });

const linked = [];

for (const source of sources) {
  if (!existsSync(source)) continue;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillDir = join(source, entry.name);
    if (!existsSync(join(skillDir, "SKILL.md"))) continue;
    const dest = join(targetRoot, entry.name);
    rmSync(dest, { recursive: true, force: true });
    symlinkSync(skillDir, dest);
    linked.push({ name: entry.name, from: skillDir });
  }
}

writeFileSync(
  join(targetRoot, "README.md"),
  `# Skills do projeto Jarvis

Este diretório é gerado por \`npm run skills:sync\`.

Skills espelhadas: **${linked.length}**

${linked.map((s) => `- \`${s.name}\` → \`${relative(projectRoot, s.from)}\``).join("\n")}

Não edite skills oficiais aqui — elas apontam para \`~/.cursor/skills-cursor\` / \`~/.cursor/skills\`.
`,
);

console.log(`Synced ${linked.length} skills → ${relative(projectRoot, targetRoot)}`);
