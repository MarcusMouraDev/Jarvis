export type MentionKind = "model" | "path" | "skill";

export interface MentionTrigger {
  kind: MentionKind;
  trigger: "@" | "#" | "/";
  start: number;
  query: string;
  replaceEnd: number;
}

export interface PathContextSummary {
  relPath: string;
  absPath?: string;
  hash: string;
  byteSize: number;
  lineCount: number;
  language: string;
  exports: string[];
  imports: string[];
  symbols: string[];
  excerpt: string;
}

export type ComposerChip =
  | { id: string; kind: "model"; alias: string; label: string }
  | { id: string; kind: "skill"; name: string; source: string; label: string }
  | {
      id: string;
      kind: "path";
      relPath: string;
      label: string;
      summary: PathContextSummary;
    }
  | {
      id: string;
      kind: "image";
      label: string;
      path?: string;
      contentBase64?: string;
      filename?: string;
    };

export interface ComposerDraft {
  text: string;
  chips: ComposerChip[];
  cursor: number;
}

export interface MentionSuggestion {
  id: string;
  kind: MentionKind;
  label: string;
  detail: string;
  value: string;
}

export interface SerializedComposerPayload {
  userText: string;
  alias: string;
  skills: string[];
  autoSelectSkills: boolean;
  contextBlocks: PathContextSummary[];
}

export function emptyDraft(): ComposerDraft {
  return { text: "", chips: [], cursor: 0 };
}
