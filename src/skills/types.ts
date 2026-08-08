export interface SkillMeta {
  name: string;
  description: string;
  path: string;
  source: "skills-cursor" | "skills" | "project" | "extra";
}

export interface SkillDocument extends SkillMeta {
  body: string;
  frontmatter: Record<string, string>;
}
