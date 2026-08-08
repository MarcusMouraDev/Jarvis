"use client";

import { useCallback, useMemo, useState } from "react";
import {
  commitMention,
  findActiveTrigger,
} from "./token-parser";
import type {
  ComposerDraft,
  MentionSuggestion,
  MentionTrigger,
} from "./mention-types";

export function useMentionAutocomplete(initial?: ComposerDraft) {
  const [draft, setDraft] = useState<ComposerDraft>(
    initial ?? { text: "", chips: [], cursor: 0 },
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);

  const trigger = useMemo(
    () => findActiveTrigger(draft.text, draft.cursor),
    [draft.text, draft.cursor],
  );

  const open = Boolean(trigger && suggestions.length > 0);

  const updateText = useCallback((text: string, cursor: number) => {
    setDraft((d) => ({ ...d, text, cursor }));
    setActiveIndex(0);
  }, []);

  const setCursor = useCallback((cursor: number) => {
    setDraft((d) => ({ ...d, cursor }));
  }, []);

  const removeChip = useCallback((id: string) => {
    setDraft((d) => ({ ...d, chips: d.chips.filter((c) => c.id !== id) }));
  }, []);

  const applySuggestion = useCallback(
    (suggestion: MentionSuggestion, active?: MentionTrigger | null) => {
      const t = active ?? findActiveTrigger(draft.text, draft.cursor);
      if (!t) return;
      setDraft((d) => commitMention(d, t, suggestion));
      setSuggestions([]);
      setActiveIndex(0);
    },
    [draft.text, draft.cursor],
  );

  const move = useCallback(
    (delta: number) => {
      if (!suggestions.length) return;
      setActiveIndex((i) => (i + delta + suggestions.length) % suggestions.length);
    },
    [suggestions.length],
  );

  const clear = useCallback(() => {
    setDraft({ text: "", chips: [], cursor: 0 });
    setSuggestions([]);
    setActiveIndex(0);
  }, []);

  return {
    draft,
    setDraft,
    trigger,
    suggestions,
    setSuggestions,
    activeIndex,
    setActiveIndex,
    open,
    updateText,
    setCursor,
    removeChip,
    applySuggestion,
    move,
    clear,
  };
}
