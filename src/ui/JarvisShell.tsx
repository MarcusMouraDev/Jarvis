"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposerChip } from "@/composer/mention-types";
import { serializeUserPrompt } from "@/composer/serialize-payload";
import {
  getProviderForAlias,
  jarvisConfig,
  listModelAliases,
} from "@/core/config";
import { BudgetTracker, requiresConfirmation } from "@/core/policy";
import type { AgentState, PrivacyClass } from "@/core/types";
import { streamChat } from "@/lib/chat-client";
import {
  decideShellApproval,
  streamShell,
} from "@/lib/shell-client";
import {
  IDLE_PRESENCE_VISUAL,
  PRESENCE_BY_STATE,
} from "@/state/presence-config";
import { AgentStateMachine } from "@/state/agent-state";
import { useAudioLevel } from "@/audio/use-audio-level";
import { useClapWake } from "@/audio/use-clap-wake";
import { speakWithBrowser } from "@/audio/speech-synthesis";
import { useVoiceListen } from "@/audio/use-voice-listen";
import { useDocumentHidden, useReducedMotion } from "@/hooks/use-reduced-motion";
import { useWebGLAvailable } from "@/hooks/use-webgl";
import { PresenceField } from "@/presence/PresenceField";
import { CommandPalette, type PaletteRun, type PaletteSkill } from "./CommandPalette";
import { Composer } from "./Composer";
import { ConfirmOverlay } from "./ConfirmOverlay";
import { FallbackStrip } from "./FallbackStrip";
import {
  HistoryPanel,
  type ChatMessage,
  type RunSummary,
} from "./HistoryPanel";
import { MemoryPanel } from "./MemoryPanel";
import { InstrumentBar } from "./InstrumentBar";
import {
  OmnirouteStatusChip,
  OmnirouteUsagePanel,
  useOmnirouteUsage,
} from "./OmnirouteUsagePanel";
import { LastExchange } from "./LastExchange";
import { PresenceStage } from "./PresenceStage";
import { StateLabel } from "./StateLabel";
import {
  TerminalPanel,
  type PendingShellApproval,
  type TerminalLine,
} from "./TerminalPanel";

const BUDGET_USD = 2;

export function JarvisShell() {
  const machine = useMemo(() => new AgentStateMachine(), []);
  const budget = useMemo(() => new BudgetTracker(BUDGET_USD), []);
  const audioRef = useRef<HTMLAudioElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const shellAbortRef = useRef<AbortController | null>(null);
  const noticedProviders = useRef<Set<string>>(new Set());

  const [state, setState] = useState<AgentState>("idle");
  const [modelAlias, setModelAlias] = useState(jarvisConfig.defaultModel);
  const [privacyClass] = useState<PrivacyClass>("internal");
  const [voiceOn, setVoiceOn] = useState(jarvisConfig.voice.autoPlay);
  const [clapWakeOn, setClapWakeOn] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [spent, setSpent] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<"messages" | "runs">("messages");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteSkills, setPaletteSkills] = useState<PaletteSkill[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [terminalExit, setTerminalExit] = useState<number | null>(null);
  const [shellRunning, setShellRunning] = useState(false);
  const [pendingShell, setPendingShell] = useState<PendingShellApproval | null>(
    null,
  );
  const [fallback, setFallback] = useState({
    visible: false,
    requestedAlias: "",
    effectiveAlias: "",
    reason: "",
  });
  const [pendingRisk, setPendingRisk] = useState<string | null>(null);
  const [firstUseVoice, setFirstUseVoice] = useState(
    jarvisConfig.policies.voiceRequiresFirstUseNotice,
  );
  const [firstUseProvider, setFirstUseProvider] = useState<string | null>(null);
  const [pendingCloudFallback, setPendingCloudFallback] = useState<{
    requestedAlias: string;
    effectiveAlias: string;
    text: string;
    payload?: ReturnType<typeof serializeUserPrompt>;
    fallbackReason?: string;
  } | null>(null);
  const [forceFallback, setForceFallback] = useState(false);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [composerChips, setComposerChips] = useState<ComposerChip[]>([]);
  const [profileId, setProfileId] = useState("conversa");
  const modelAliases = useMemo(() => listModelAliases(), []);

  const reducedMotion = useReducedMotion();
  const documentHidden = useDocumentHidden();
  const webglAvailable = useWebGLAvailable();
  const listening = state === "listening";
  const { levelRef: audioLevelRef, micPermission } = useAudioLevel(state, audioRef, {
    enabled: !reducedMotion && !listening,
  });

  const [instrumentHeight, setInstrumentHeight] = useState(56);
  const [usageOpen, setUsageOpen] = useState(false);
  const usage = useOmnirouteUsage({ open: usageOpen });
  const onInstrumentHeight = useCallback((h: number) => {
    setInstrumentHeight(Math.max(40, Math.round(h)));
  }, []);

  useEffect(() => {
    const desktop = window.jarvisDesktop;
    if (!desktop) return;
    return desktop.onOpenUsagePanel(() => setUsageOpen(true));
  }, []);

  const [glow, setGlow] = useState(IDLE_PRESENCE_VISUAL.colorA);
  const panelOpen = historyOpen || memoryOpen || terminalOpen || paletteOpen;

  const go = useCallback(
    (to: AgentState) => {
      try {
        machine.transition(to);
      } catch {
        machine.force(to);
      }
      const next = machine.current;
      setState(next);
      setGlow((prev) =>
        next === "failure" ? prev : PRESENCE_BY_STATE[next].colorA,
      );
    },
    [machine],
  );

  const pushMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
    void fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: msg.id,
        role: msg.role,
        text: msg.text,
        meta: msg.meta,
      }),
    }).catch(() => {
      // Persistence is best-effort.
    });
  }, []);

  const handleClapWake = useCallback(() => {
    go("listening");
    pushMessage({
      id: crypto.randomUUID(),
      role: "system",
      text: "*clap clap* detectado — Jarvis ouvindo.",
    });
  }, [go, pushMessage]);

  useClapWake({
    enabled: clapWakeOn && !reducedMotion,
    state,
    onWake: handleClapWake,
  });

  const refreshRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs?limit=40");
      if (!res.ok) return;
      const data = (await res.json()) as { runs: RunSummary[] };
      setRuns(data.runs ?? []);
    } catch {
      // ignore
    }
  }, []);

  const cancelActive = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    shellAbortRef.current?.abort();
    shellAbortRef.current = null;
    setBusy(false);
    setShellRunning(false);
    setPendingRisk(null);
    setPendingShell(null);
    setFirstUseProvider(null);
    setPendingCloudFallback(null);
    setPaletteOpen(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
    }
    go("idle");
    pushMessage({
      id: crypto.randomUUID(),
      role: "system",
      text: "Cancelado.",
    });
  }, [go, pushMessage]);

  const appendTerminal = useCallback(
    (kind: TerminalLine["kind"], text: string) => {
      setTerminalLines((prev) => [
        ...prev,
        { id: crypto.randomUUID(), kind, text },
      ]);
    },
    [],
  );

  const runShell = useCallback(
    async (command: string, approvalId?: string) => {
      setTerminalOpen(true);
      setTerminalExit(null);
      setShellRunning(true);
      setPendingShell(null);
      if (!approvalId) {
        appendTerminal("cmd", `$ ${command}`);
      }
      go("thinking");
      const controller = new AbortController();
      shellAbortRef.current = controller;

      try {
        await streamShell(
          { command, approvalId },
          {
            onNeedsApproval: (payload) => {
              setPendingShell({
                approvalId: payload.approvalId,
                runId: payload.runId,
                command,
                classified: payload.classified,
                cwd: payload.cwd,
                timeoutMs: payload.timeoutMs,
              });
              setShellRunning(false);
              go("asking");
            },
            onClassified: (c) => {
              appendTerminal(
                "meta",
                `# ${c.tier}${c.reasons.length ? ` · ${c.reasons.join(", ")}` : ""}`,
              );
            },
            onStdout: (text) => appendTerminal("stdout", text),
            onStderr: (text) => appendTerminal("stderr", text),
            onExit: ({ exitCode }) => {
              setTerminalExit(exitCode);
              appendTerminal(
                "meta",
                `# exit ${exitCode ?? "?"}`,
              );
              void refreshRuns();
            },
            onError: (error) => {
              appendTerminal("stderr", error);
              go("failure");
            },
          },
          controller.signal,
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : "erro";
        appendTerminal("stderr", message);
        go("failure");
      } finally {
        setShellRunning(false);
        shellAbortRef.current = null;
        if (machine.current === "thinking") go("idle");
      }
    },
    [appendTerminal, go, machine, refreshRuns],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        cancelActive();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setHistoryOpen((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        const editable =
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target?.isContentEditable;
        if (editable) return;
        e.preventDefault();
        setVoiceOn((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (state === "listening") go("idle");
        else if (state === "idle") go("listening");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelActive, go, paletteOpen, state]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/skills");
        if (!res.ok) return;
        const data = (await res.json()) as { skills: PaletteSkill[] };
        setPaletteSkills(data.skills ?? []);
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    if (!paletteOpen) return;
    void (async () => {
      try {
        const [skillsRes, runsRes] = await Promise.all([
          fetch("/api/skills"),
          fetch("/api/runs?limit=12"),
        ]);
        if (skillsRes.ok) {
          const data = (await skillsRes.json()) as {
            skills: PaletteSkill[];
          };
          setPaletteSkills(data.skills ?? []);
        }
        if (runsRes.ok) {
          const data = (await runsRes.json()) as { runs: PaletteRun[] };
          setRuns(data.runs ?? []);
        }
      } catch {
        // ignore
      }
    })();
  }, [paletteOpen]);

  const speakText = async (text: string, signal?: AbortSignal) => {
    if (firstUseVoice) {
      setFirstUseVoice(false);
      pushMessage({
        id: crypto.randomUUID(),
        role: "system",
        text: "Primeiro uso de voz: leitura via síntese do navegador.",
      });
    }

    go("thinking");
    setBusy(true);
    try {
      if (signal?.aborted) throw new Error("aborted");
      go("speaking");
      await speakWithBrowser(text, {
        locale: jarvisConfig.voice.locale,
        signal,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "aborted") return;
      go("failure");
      pushMessage({
        id: crypto.randomUUID(),
        role: "system",
        text: "Falha de voz — texto preservado acima.",
      });
    } finally {
      setBusy(false);
      if (machine.current === "speaking" || machine.current === "thinking") {
        go("idle");
      }
    }
  };

  const runSlash = async (raw: string): Promise<boolean> => {
    const parts = raw.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    if (cmd === "/run") {
      const command = raw.replace(/^\/run\s*/i, "").trim();
      if (!command) {
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: "Uso: /run <comando>  ou  !<comando>",
        });
        return true;
      }
      await runShell(command);
      return true;
    }

    if (cmd === "/select" && parts[1] === "model") {
      const alias = parts[2];
      if (!alias || !listModelAliases().includes(alias)) {
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `Alias inválido: ${alias ?? "(vazio)"}. Modelo ativo permanece ${modelAlias}.`,
        });
        return true;
      }
      setModelAlias(alias);
      pushMessage({
        id: crypto.randomUUID(),
        role: "system",
        text: `Modelo ativo: ${alias}`,
      });
      return true;
    }

    if (cmd === "/voice") {
      const sub = parts[1]?.toLowerCase();
      if (sub === "on") {
        setVoiceOn(true);
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: "Voz ligada.",
        });
        return true;
      }
      if (sub === "off") {
        setVoiceOn(false);
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: "Voz desligada.",
        });
        return true;
      }
      if (sub === "status") {
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `Voz ${voiceOn ? "ligada" : "desligada"} · ${jarvisConfig.voice.voiceId}`,
        });
        return true;
      }
      if (sub === "select" && parts[2]) {
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `Voz selecionada (mock): ${parts[2]}`,
        });
        return true;
      }
    }

    if (cmd === "/clap") {
      const sub = parts[1]?.toLowerCase();
      if (sub === "on") {
        setClapWakeOn(true);
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: "Ativação por duas palmas ligada. Bata palmas duas vezes para ouvir.",
        });
        return true;
      }
      if (sub === "off") {
        setClapWakeOn(false);
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: "Ativação por palmas desligada.",
        });
        return true;
      }
      pushMessage({
        id: crypto.randomUUID(),
        role: "system",
        text: `Palmas ${clapWakeOn ? "ligadas" : "desligadas"} · duas palmas rápidas ativam o modo ouvir`,
      });
      return true;
    }

    if (cmd === "/speak") {
      const text = raw.replace(/^\/speak\s*/i, "").trim();
      if (!text) {
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: "Uso: /speak <texto>",
        });
        return true;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      await speakText(text, controller.signal);
      return true;
    }

    if (cmd === "/profile") {
      const next = parts[1]?.toLowerCase();
      if (!next) {
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `Perfil ativo: ${profileId}. Uso: /profile <conversa|pesquisa|briefing|monitor>`,
        });
        return true;
      }
      try {
        const res = await fetch(`/api/profiles?id=${encodeURIComponent(next)}`);
        if (!res.ok) {
          pushMessage({
            id: crypto.randomUUID(),
            role: "system",
            text: `Perfil desconhecido: ${next}`,
          });
          return true;
        }
        setProfileId(next);
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `Perfil ativo: ${next}`,
        });
      } catch {
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: "Não foi possível trocar o perfil.",
        });
      }
      return true;
    }

    if (cmd === "/memory") {
      setMemoryOpen(true);
      pushMessage({
        id: crypto.randomUUID(),
        role: "system",
        text: "Painel de memória aberto.",
      });
      return true;
    }

    if (cmd === "/fail") {
      setForceFallback(true);
      pushMessage({
        id: crypto.randomUUID(),
        role: "system",
        text: "Próxima mensagem forçará fallback (se houver).",
      });
      return true;
    }

    if (cmd === "/skill" || cmd === "/skills") {
      const sub = parts[1]?.toLowerCase();
      if (!sub || sub === "list") {
        const res = await fetch("/api/skills");
        const data = (await res.json()) as {
          count: number;
          skills: Array<{ name: string; source: string; description: string }>;
        };
        const preview = data.skills
          .slice(0, 30)
          .map((s) => `• ${s.name} (${s.source})`)
          .join("\n");
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `Skills disponíveis: ${data.count}\n${preview}${
            data.count > 30 ? "\n…" : ""
          }\nAtivas: ${activeSkills.length ? activeSkills.join(", ") : "(auto)"}`,
        });
        return true;
      }
      if (sub === "use" && parts[2]) {
        const name = parts[2];
        setActiveSkills((prev) =>
          prev.includes(name) ? prev : [...prev, name],
        );
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `Skill ativada: ${name}`,
        });
        return true;
      }
      if (sub === "clear") {
        setActiveSkills([]);
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: "Skills manuais limpas — volta a seleção automática.",
        });
        return true;
      }
      if (sub === "show" && parts[2]) {
        const res = await fetch(`/api/skills/${encodeURIComponent(parts[2])}`);
        if (!res.ok) {
          pushMessage({
            id: crypto.randomUUID(),
            role: "system",
            text: `Skill não encontrada: ${parts[2]}`,
          });
          return true;
        }
        const skill = (await res.json()) as {
          name: string;
          description: string;
          body: string;
        };
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `# ${skill.name}\n${skill.description}\n\n${skill.body.slice(0, 4000)}`,
        });
        return true;
      }
    }

    return false;
  };

  const handleSubmit = async () => {
    const text = input.trim();
    if ((!text && composerChips.length === 0) || busy) return;

    if (text.startsWith("!")) {
      setInput("");
      setComposerChips([]);
      await runShell(text.slice(1).trim());
      return;
    }

    if (requiresConfirmation(text) && !text.startsWith("/")) {
      setPendingRisk(text);
      go("asking");
      return;
    }

    if (text.startsWith("/")) {
      setInput("");
      setComposerChips([]);
      setBusy(true);
      try {
        const handled = await runSlash(text);
        if (!handled) {
          pushMessage({
            id: crypto.randomUUID(),
            role: "system",
            text: `Comando desconhecido: ${text}`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "erro";
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `Falha no comando: ${message}`,
        });
        go("failure");
      } finally {
        setBusy(false);
        if (machine.current !== "speaking" && machine.current !== "failure" && machine.current !== "asking") {
          go("idle");
        }
      }
      return;
    }

    const payload = serializeUserPrompt(
      { text: input, chips: composerChips, cursor: input.length },
      modelAlias,
    );
    if (payload.alias !== modelAlias) {
      setModelAlias(payload.alias);
    }
    const provider = getProviderForAlias(payload.alias);
    if (!noticedProviders.current.has(provider)) {
      setFirstUseProvider(provider);
      go("asking");
      return;
    }

    await sendChat(payload.userText || text, payload);
  };

  const sendChat = async (
    text: string,
    payload?: ReturnType<typeof serializeUserPrompt>,
    confirmedCloudFallback = false,
  ) => {
    const effective =
      payload ??
      serializeUserPrompt(
        { text, chips: composerChips, cursor: text.length },
        modelAlias,
      );
    setInput("");
    setComposerChips([]);
    const chipMeta = [
      effective.alias !== modelAlias ? `@${effective.alias}` : null,
      ...effective.skills.map((s) => `/${s}`),
      ...effective.contextBlocks.map((b) => `#${b.relPath}`),
    ]
      .filter(Boolean)
      .join(" · ");
    pushMessage({
      id: crypto.randomUUID(),
      role: "user",
      text,
      meta: chipMeta || undefined,
    });
    go("thinking");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const assistantId = crypto.randomUUID();
    let full = "";
    let sawDone = false;
    let consentPending = false;
    const skills =
      effective.skills.length > 0
        ? effective.skills
        : activeSkills.length
          ? activeSkills
          : undefined;

    try {
      await streamChat(
        {
          alias: effective.alias,
          prompt: text,
          privacyClass,
          skills,
          autoSelectSkills: effective.autoSelectSkills && !activeSkills.length,
          forceFallback,
          contextBlocks: effective.contextBlocks.length
            ? effective.contextBlocks
            : undefined,
          profile: profileId,
          confirmedCloudFallback,
        },
        {
          onSkills: (skills) => {
            if (!skills.length) return;
            pushMessage({
              id: crypto.randomUUID(),
              role: "system",
              text: `Skills aplicadas: ${skills.map((s) => s.name).join(", ")}`,
            });
          },
          onRoute: (route) => {
            setFallback({
              visible: route.fallbackUsed,
              requestedAlias: route.requestedAlias,
              effectiveAlias: route.effectiveAlias,
              reason: route.fallbackReason ?? "",
            });
          },
          onConsentRequired: (consent) => {
            consentPending = true;
            setPendingCloudFallback({
              requestedAlias: consent.requestedAlias,
              effectiveAlias: consent.effectiveAlias,
              text,
              payload: effective,
              fallbackReason: consent.fallbackReason,
            });
            go("asking");
          },
          onChunk: (chunk) => {
            full += chunk;
            setMessages((prev) => {
              const exists = prev.some((m) => m.id === assistantId);
              if (!exists) {
                return [
                  ...prev,
                  {
                    id: assistantId,
                    role: "assistant" as const,
                    text: full,
                    meta: "streaming…",
                  },
                ];
              }
              return prev.map((m) =>
                m.id === assistantId ? { ...m, text: full } : m,
              );
            });
          },
          onDone: (response) => {
            sawDone = true;
            setForceFallback(false);
            full = response.text || full;
            try {
              budget.charge(response.usage.estimatedCostUsd);
              setSpent(budget.totalSpent);
            } catch {
              go("asking");
              pushMessage({
                id: crypto.randomUUID(),
                role: "system",
                text: "Orçamento da sessão excedido.",
              });
              return;
            }
            setFallback({
              visible: response.fallbackUsed,
              requestedAlias: modelAlias,
              effectiveAlias: response.model,
              reason: response.fallbackReason ?? "",
            });
            setMessages((prev) => {
              const exists = prev.some((m) => m.id === assistantId);
              const meta = `${response.model} · ${response.provider} · ${response.usage.totalTokens} tokens`;
              if (!exists) {
                return [
                  ...prev,
                  {
                    id: assistantId,
                    role: "assistant",
                    text: full,
                    meta,
                  },
                ];
              }
              return prev.map((m) =>
                m.id === assistantId ? { ...m, text: full, meta } : m,
              );
            });
            void refreshRuns();
          },
          onError: (error) => {
            throw new Error(error);
          },
        },
        controller.signal,
      );

      if (consentPending) return;

      if (!sawDone && !controller.signal.aborted) {
        throw new Error("stream_incomplete");
      }

      if (voiceOn && full) {
        await speakText(full, controller.signal);
      } else {
        go("idle");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "erro";
      if (message === "aborted") return;
      go("failure");
      pushMessage({
        id: crypto.randomUUID(),
        role: "system",
        text: `Falha: ${message}`,
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
      if (
        machine.current !== "speaking" &&
        machine.current !== "asking" &&
        machine.current !== "failure"
      ) {
        go("idle");
      }
    }
  };

  const sendChatRef = useRef(sendChat);
  useEffect(() => {
    sendChatRef.current = sendChat;
  });

  const handleVoiceTranscript = useCallback(
    async (text: string) => {
      pushMessage({
        id: crypto.randomUUID(),
        role: "user",
        text,
      });
      setInput("");
      setComposerChips([]);
      await sendChatRef.current(text);
    },
    [pushMessage],
  );

  const { levelRef: listenLevelRef } = useVoiceListen({
    active: listening && !busy,
    onTranscript: (text) => {
      void handleVoiceTranscript(text);
    },
    onError: (message) => {
      pushMessage({
        id: crypto.randomUUID(),
        role: "system",
        text: `Whisper: falha na transcrição (${message}).`,
      });
      go("failure");
    },
  });

  const levelRef = listening ? listenLevelRef : audioLevelRef;

  const handlePaletteAction = async (
    action: string,
    meta?: { skill?: string; shift?: boolean },
  ) => {
    setPaletteOpen(false);
    if (action === "skill-use" && meta?.skill) {
      if (meta.shift) await runSlash(`/skill show ${meta.skill}`);
      else await runSlash(`/skill use ${meta.skill}`);
      return;
    }
    if (action === "history") {
      setHistoryTab("messages");
      setHistoryOpen(true);
      return;
    }
    if (action === "runs") {
      setHistoryTab("runs");
      setHistoryOpen(true);
      void refreshRuns();
      return;
    }
    if (action === "terminal") {
      setTerminalOpen(true);
      return;
    }
    if (action === "voice-toggle") {
      setVoiceOn((v) => !v);
      return;
    }
    if (action === "listen-toggle") {
      if (state === "listening") go("idle");
      else if (state === "idle") go("listening");
      return;
    }
    if (action === "model-gemini") {
      await runSlash("/select model gemini");
      return;
    }
    if (action === "model-codex") {
      await runSlash("/select model codex");
      return;
    }
    if (action === "skills-list") {
      await runSlash("/skills list");
      return;
    }
    if (action === "show-run" && meta?.skill) {
      setHistoryTab("runs");
      setHistoryOpen(true);
      void refreshRuns();
    }
  };

  const provider = getProviderForAlias(modelAlias);

  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-x-clip"
      style={
        {
          "--state-glow": glow,
          "--instrument-height": `${instrumentHeight}px`,
        } as React.CSSProperties
      }
    >
      <div className="shell-vignette" aria-hidden />

      <InstrumentBar
        privacyClass={privacyClass}
        profile={profileId}
        modelAlias={modelAlias}
        provider={provider}
        spentUsd={spent}
        budgetUsd={BUDGET_USD}
        voiceOn={voiceOn}
        clapWakeOn={clapWakeOn}
        micPermission={micPermission}
        extra={
          <OmnirouteStatusChip
            report={usage.report}
            onOpen={() => setUsageOpen(true)}
          />
        }
        onHeightChange={onInstrumentHeight}
      />

      <main className="relative z-20 flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-3 pt-3 sm:px-4 sm:pt-4">
        <OmnirouteUsagePanel
          open={usageOpen}
          report={usage.report}
          loading={usage.loading}
          onClose={() => setUsageOpen(false)}
          onRefresh={() => void usage.refresh()}
        />
        <div className="presence-arena flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-2">
          <PresenceStage state={state} compact={panelOpen}>
            <PresenceField
              state={state}
              levelRef={levelRef}
              reducedMotion={reducedMotion}
              paused={documentHidden}
              webglAvailable={webglAvailable}
            />
          </PresenceStage>

          <div className="presence-caption mt-3 flex w-full flex-col items-center gap-2 sm:mt-4">
            <StateLabel state={state} />
            <FallbackStrip
              visible={fallback.visible}
              requestedAlias={fallback.requestedAlias}
              effectiveAlias={fallback.effectiveAlias}
              reason={fallback.reason}
            />
          </div>

          <LastExchange messages={messages} />

          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              className="btn-press text-xs whitespace-nowrap text-ink-2 underline-offset-2 hover:text-ink-1 hover:underline"
              onClick={() => setHistoryOpen(true)}
            >
              histórico ^H ({messages.length})
            </button>
            <button
              type="button"
              className="btn-press text-xs whitespace-nowrap text-ink-2 underline-offset-2 hover:text-ink-1 hover:underline"
              onClick={() => setMemoryOpen(true)}
            >
              memória
            </button>
            <button
              type="button"
              className="btn-press text-xs whitespace-nowrap text-ink-2 underline-offset-2 hover:text-ink-1 hover:underline"
              onClick={() => setTerminalOpen(true)}
            >
              terminal
            </button>
            <button
              type="button"
              className="btn-press text-xs whitespace-nowrap text-ink-2 underline-offset-2 hover:text-ink-1 hover:underline"
              onClick={() => setPaletteOpen(true)}
            >
              ⌘K
            </button>
          </div>
        </div>
      </main>

      <Composer
        value={input}
        chips={composerChips}
        disabled={busy || Boolean(pendingRisk) || Boolean(firstUseProvider) || Boolean(pendingCloudFallback)}
        busy={busy}
        onChange={setInput}
        onChipsChange={setComposerChips}
        onSubmit={() => void handleSubmit()}
        onCancel={cancelActive}
        skillCatalog={paletteSkills}
        modelAliases={modelAliases}
      />

      <HistoryPanel
        open={historyOpen}
        messages={messages}
        runs={runs}
        tab={historyTab}
        onTabChange={(tab) => {
          setHistoryTab(tab);
          if (tab === "runs") void refreshRuns();
        }}
        onClose={() => setHistoryOpen(false)}
      />

      <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} />

      <TerminalPanel
        open={terminalOpen}
        lines={terminalLines}
        exitCode={terminalExit}
        running={shellRunning}
        pending={pendingShell}
        onClose={() => setTerminalOpen(false)}
        onCancel={() => {
          shellAbortRef.current?.abort();
          setShellRunning(false);
          go("idle");
        }}
        onApprove={() => {
          if (!pendingShell) return;
          const { approvalId, command } = pendingShell;
          setPendingShell(null);
          void (async () => {
            await decideShellApproval(approvalId, "approved");
            await runShell(command, approvalId);
          })();
        }}
        onDeny={() => {
          if (!pendingShell) return;
          const id = pendingShell.approvalId;
          setPendingShell(null);
          void decideShellApproval(id, "denied");
          appendTerminal("meta", "# recusado");
          go("idle");
          void refreshRuns();
        }}
      />

      {paletteOpen ? (
        <CommandPalette
          skills={paletteSkills}
          runs={runs}
          onClose={() => setPaletteOpen(false)}
          onAction={(action, meta) => void handlePaletteAction(action, meta)}
        />
      ) : null}

      {pendingCloudFallback ? (
        <ConfirmOverlay
          title="Fallback confidencial para nuvem"
          body={`Dados classificados como "${privacyClass}" não puderam ser atendidos localmente (${pendingCloudFallback.requestedAlias}). O fallback enviaria para ${pendingCloudFallback.effectiveAlias} na nuvem. Continuar?`}
          confirmLabel="Enviar para nuvem"
          onCancel={() => {
            setPendingCloudFallback(null);
            go("idle");
            pushMessage({
              id: crypto.randomUUID(),
              role: "system",
              text: "Fallback para nuvem cancelado — mensagem não enviada.",
            });
          }}
          onConfirm={() => {
            const pending = pendingCloudFallback;
            setPendingCloudFallback(null);
            go("idle");
            queueMicrotask(() =>
              void sendChat(pending.text, pending.payload, true),
            );
          }}
        />
      ) : null}

      {firstUseProvider ? (
        <ConfirmOverlay
          title="Primeiro uso deste provedor"
          body={`Você está prestes a enviar dados classificados como "${privacyClass}" para ${firstUseProvider}. Continuar?`}
          confirmLabel="Continuar"
          onCancel={() => {
            setFirstUseProvider(null);
            go("idle");
          }}
          onConfirm={() => {
            const pending = input.trim();
            noticedProviders.current.add(firstUseProvider);
            setFirstUseProvider(null);
            go("idle");
            if (pending) queueMicrotask(() => void sendChat(pending));
          }}
        />
      ) : null}

      {pendingRisk ? (
        <ConfirmOverlay
          title="Confirmar ação de risco"
          body={`O comando parece destrutivo ou de rede: "${pendingRisk}". Deseja continuar?`}
          onCancel={() => {
            setPendingRisk(null);
            go("idle");
          }}
          onConfirm={() => {
            const cmd = pendingRisk;
            setPendingRisk(null);
            go("idle");
            queueMicrotask(() => void sendChat(cmd));
          }}
        />
      ) : null}

      <audio ref={audioRef} className="hidden" preload="none" />
    </div>
  );
}
