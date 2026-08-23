import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { SkillDocument, SkillMeta } from "./types";

function parseFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!raw.startsWith("---")) {
    return { frontmatter: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: raw };
  const header = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*/, "");
  const frontmatter: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

const SOURCE_RANK: Record<SkillMeta["source"], number> = {
  project: 6,
  codex: 5,
  claude: 5,
  agents: 4,
  skills: 3,
  "skills-cursor": 2,
  extra: 1,
};

function sourceLabel(dir: string): SkillMeta["source"] {
  const normalized = dir.replaceAll("\\", "/");
  if (normalized.includes("/.cursor/skills-cursor")) return "skills-cursor";
  if (normalized.includes("/.codex/skills")) return "codex";
  if (normalized.includes("/.claude/skills")) return "claude";
  if (normalized.includes("/.agents/skills")) return "agents";
  if (normalized.includes("/.cursor/skills")) {
    if (dir.startsWith(homedir())) return "skills";
    return "project";
  }
  return "extra";
}

export function defaultSkillRoots(): string[] {
  const home = homedir();
  const roots = [
    join(home, ".cursor", "skills-cursor"),
    join(home, ".cursor", "skills"),
    join(home, ".codex", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".agents", "skills"),
    resolve(process.cwd(), ".cursor", "skills"),
  ];
  const extra = process.env.CURSOR_SKILLS_DIRS?.split(":")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra?.length) roots.push(...extra.map((p) => resolve(p)));
  return [
    ...new Set(roots.filter((p) => existsSync(/* turbopackIgnore: true */ p))),
  ];
}

function listSkillDirs(root: string): string[] {
  try {
    return readdirSync(/* turbopackIgnore: true */ root, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => join(root, d.name))
      .filter((dir) =>
        existsSync(/* turbopackIgnore: true */ join(dir, "SKILL.md")),
      );
  } catch {
    return [];
  }
}

export function listSkills(roots = defaultSkillRoots()): SkillMeta[] {
  const byName = new Map<string, SkillMeta>();

  for (const root of roots) {
    for (const dir of listSkillDirs(root)) {
      const skillPath = join(dir, "SKILL.md");
      try {
        const raw = readFileSync(/* turbopackIgnore: true */ skillPath, "utf8");
        const { frontmatter } = parseFrontmatter(raw);
        const name = frontmatter.name || dir.split(/[\\/]/).pop() || "unknown";
        // Prefer project > personal skills > built-in skills-cursor when names collide.
        const source = sourceLabel(root);
        const existing = byName.get(name);
        if (!existing || SOURCE_RANK[source] >= SOURCE_RANK[existing.source]) {
          byName.set(name, {
            name,
            description: frontmatter.description || "",
            path: skillPath,
            source,
          });
        }
      } catch {
        // skip unreadable
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSkill(
  name: string,
  roots = defaultSkillRoots(),
): SkillDocument | null {
  const meta = listSkills(roots).find((s) => s.name === name);
  if (!meta) return null;
  const raw = readFileSync(/* turbopackIgnore: true */ meta.path, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  return { ...meta, frontmatter, body };
}

export function selectSkillsForPrompt(
  prompt: string,
  options?: { names?: string[]; limit?: number },
): SkillDocument[] {
  const limit = options?.limit ?? 3;
  if (options?.names?.length) {
    return options.names
      .map((n) => loadSkill(n))
      .filter((s): s is SkillDocument => Boolean(s))
      .slice(0, limit);
  }

  const tokens = prompt
    .toLowerCase()
    .split(/[^a-z0-9áàâãéêíóôõúç_-]+/i)
    .filter((t) => t.length > 2);
  const scored = listSkills()
    .map((meta) => {
      const hay = `${meta.name} ${meta.description}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += 1;
      }
      // light boost for coding-related built-ins when prompt looks like engineering
      if (
        /(código|code|bug|pr|lint|test|api|skill|cursor|sdk)/i.test(prompt) &&
        /(sdk|review|fix|shell|create)/i.test(meta.name)
      ) {
        score += 0.5;
      }
      return { meta, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored
    .map((s) => loadSkill(s.meta.name))
    .filter((s): s is SkillDocument => Boolean(s));
}

export function formatSkillsForSystemPrompt(skills: SkillDocument[]): string {
  if (!skills.length) return "";
  const blocks = skills.map(
    (s) =>
      `### Skill: ${s.name}\nFonte: ${s.source}\nDescrição: ${s.description}\n\n${s.body}`,
  );
  return [
    "Você tem acesso às seguintes Agent Skills do Cursor. Aplique as relevantes ao pedido.",
    "Se uma skill se aplicar, siga suas instruções. Não invente skills que não estejam listadas.",
    "",
    ...blocks,
  ].join("\n\n");
}
