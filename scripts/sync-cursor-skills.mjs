#!/usr/bin/env node
/**
 * Espelha skills do host em .cursor/skills do projeto via symlinks.
 * Fontes (prioridade crescente — a última vence em colisão de nome):
 *   ~/.cursor/skills-cursor, ~/.cursor/skills, ~/.claude/skills,
 *   ~/.codex/skills, ~/.agents/skills
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const targetRoot = join(projectRoot, ".cursor", "skills");
const sources = [
  { label: "cursor/skills-cursor", path: join(homedir(), ".cursor", "skills-cursor") },
  { label: "cursor/skills", path: join(homedir(), ".cursor", "skills") },
  { label: "claude/skills", path: join(homedir(), ".claude", "skills") },
  { label: "codex/skills", path: join(homedir(), ".codex", "skills") },
  { label: "agents/skills", path: join(homedir(), ".agents", "skills") },
];

mkdirSync(targetRoot, { recursive: true });

const linked = [];
const byName = new Map();

for (const { label, path: source } of sources) {
  if (!existsSync(source)) continue;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillDir = join(source, entry.name);
    if (!existsSync(join(skillDir, "SKILL.md"))) continue;
    const dest = join(targetRoot, entry.name);
    rmSync(dest, { recursive: true, force: true });
    symlinkSync(skillDir, dest);
    byName.set(entry.name, { name: entry.name, from: skillDir, source: label });
  }
}

linked.push(...byName.values());

writeFileSync(
  join(targetRoot, "README.md"),
  `# Skills do projeto Jarvis

Este diretório é gerado por \`npm run skills:sync\`.

Skills espelhadas: **${linked.length}**

| Fonte | Skills |
| --- | --- |
${sources
  .map(
    (s) =>
      `| \`${s.label}\` | ${linked.filter((l) => l.source === s.label).length} |`,
  )
  .join("\n")}

${linked.map((s) => `- \`${s.name}\` (\`${s.source}\`) → \`${relative(projectRoot, s.from)}\``).join("\n")}

Não edite skills oficiais aqui — são symlinks para o host.
`,
);

console.log(`Synced ${linked.length} skills → ${relative(projectRoot, targetRoot)}`);
