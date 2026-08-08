import type {
  ComposerChip,
  ComposerDraft,
  MentionKind,
  MentionSuggestion,
  MentionTrigger,
  SerializedComposerPayload,
} from "./mention-types";

const SLASH_COMMANDS = new Set([
  "run",
  "select",
  "voice",
  "speak",
  "fail",
  "skill",
  "skills",
  "profile",
  "memory",
]);

function isWordBoundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  return /\s/.test(text[index - 1] ?? "");
}

function isLineLeadingSlash(text: string, index: number): boolean {
  if (text[index] !== "/") return false;
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return text.slice(lineStart, index).trim().length === 0;
}

export function findActiveTrigger(
  text: string,
  cursor: number,
): MentionTrigger | null {
  const c = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, c);
  // Paths may contain `/`; models/skills stay single-token.
  const match = before.match(/(@)([^\s@#/]*)$|(#)([^\s@#]*)$|(\/)([^\s@#/]*)$/);
  if (!match || match.index === undefined) return null;

  const start = match.index;
  const trigger = (match[1] ?? match[3] ?? match[5]) as "@" | "#" | "/";
  const query = match[2] ?? match[4] ?? match[6] ?? "";

  if (!isWordBoundary(text, start)) return null;

  // Line-leading slash commands stay as commands, not skill mentions.
  if (trigger === "/" && isLineLeadingSlash(text, start)) {
    const first = query.split(/\s/)[0]?.toLowerCase() ?? "";
    if (!first || SLASH_COMMANDS.has(first) || first.startsWith("select")) {
      return null;
    }
  }

  const kind: MentionKind =
    trigger === "@" ? "model" : trigger === "#" ? "path" : "skill";

  return { kind, trigger, start, query, replaceEnd: c };
}

export function commitMention(
  draft: ComposerDraft,
  trigger: MentionTrigger,
  selection: MentionSuggestion,
): ComposerDraft {
  const before = draft.text.slice(0, trigger.start);
  const after = draft.text.slice(trigger.replaceEnd);
  const spacer =
    before.length > 0 && !/\s$/.test(before) ? "" : "";
  const nextText = `${before}${spacer}${after}`.replace(/\s{2,}/g, " ");
  const chipId = crypto.randomUUID();

  let chip: ComposerChip;
  if (selection.kind === "model") {
    chip = {
      id: chipId,
      kind: "model",
      alias: selection.value,
      label: selection.label,
    };
  } else if (selection.kind === "skill") {
    const [name, source = "extra"] = selection.value.includes("|")
      ? selection.value.split("|")
      : [selection.value, "extra"];
    chip = {
      id: chipId,
      kind: "skill",
      name,
      source,
      label: selection.label,
    };
  } else {
    chip = {
      id: chipId,
      kind: "path",
      relPath: selection.value,
      label: selection.label,
      summary: {
        relPath: selection.value,
        absPath: selection.value,
        hash: "",
        byteSize: 0,
        lineCount: 0,
        language: "text",
        exports: [],
        imports: [],
        symbols: [],
        excerpt: "",
      },
    };
  }

  // One model chip at a time.
  const chips =
    chip.kind === "model"
      ? [...draft.chips.filter((c) => c.kind !== "model"), chip]
      : draft.chips.some(
            (c) =>
              (c.kind === "skill" &&
                chip.kind === "skill" &&
                c.name === chip.name) ||
              (c.kind === "path" &&
                chip.kind === "path" &&
                c.relPath === chip.relPath),
          )
        ? draft.chips
        : [...draft.chips, chip].slice(0, 12);

  const cursor = Math.min(nextText.length, before.length + spacer.length);
  return { text: nextText, chips, cursor };
}

export function serializeUserPrompt(
  draft: ComposerDraft,
  sessionAlias: string,
): SerializedComposerPayload {
  const modelChip = [...draft.chips]
    .reverse()
    .find((c): c is Extract<ComposerChip, { kind: "model" }> => c.kind === "model");
  const skills = draft.chips
    .filter((c): c is Extract<ComposerChip, { kind: "skill" }> => c.kind === "skill")
    .map((c) => c.name)
    .slice(0, 4);
  const contextBlocks = draft.chips
    .filter((c): c is Extract<ComposerChip, { kind: "path" }> => c.kind === "path")
    .map((c) => c.summary)
    .slice(0, 6);

  return {
    userText: draft.text.trim(),
    alias: modelChip?.alias ?? sessionAlias,
    skills,
    autoSelectSkills: skills.length === 0,
    contextBlocks,
  };
}
