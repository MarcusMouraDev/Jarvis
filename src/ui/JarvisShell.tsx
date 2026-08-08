"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MockVoiceAdapter } from "@/adapters/mock-voice";
import {
  getProviderForAlias,
  jarvisConfig,
  listModelAliases,
} from "@/core/config";
import { BudgetTracker, requiresConfirmation } from "@/core/policy";
import type { AgentState, PrivacyClass } from "@/core/types";
import { streamChat } from "@/lib/chat-client";
import { AgentStateMachine } from "@/state/agent-state";
import { useAudioLevel } from "@/audio/use-audio-level";
import { useDocumentHidden, useReducedMotion } from "@/hooks/use-reduced-motion";
import { useWebGLAvailable } from "@/hooks/use-webgl";
import { PresenceField } from "@/presence/PresenceField";
import { Composer } from "./Composer";
import { ConfirmOverlay } from "./ConfirmOverlay";
import { FallbackStrip } from "./FallbackStrip";
import { HistoryPanel, type ChatMessage } from "./HistoryPanel";
import { InstrumentBar } from "./InstrumentBar";
import { LastExchange } from "./LastExchange";
import { StateLabel } from "./StateLabel";

const BUDGET_USD = 2;

export function JarvisShell() {
  const machine = useMemo(() => new AgentStateMachine(), []);
  const budget = useMemo(() => new BudgetTracker(BUDGET_USD), []);
  const audioRef = useRef<HTMLAudioElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const noticedProviders = useRef<Set<string>>(new Set());

  const [state, setState] = useState<AgentState>("idle");
  const [modelAlias, setModelAlias] = useState(jarvisConfig.defaultModel);
  const [privacyClass] = useState<PrivacyClass>("internal");
  const [voiceOn, setVoiceOn] = useState(jarvisConfig.voice.autoPlay);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [spent, setSpent] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
  const [forceFallback, setForceFallback] = useState(false);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);

  const reducedMotion = useReducedMotion();
  const documentHidden = useDocumentHidden();
  const webglAvailable = useWebGLAvailable();
  const { levelRef, micPermission } = useAudioLevel(state, audioRef, {
    enabled: !reducedMotion,
  });

  const go = useCallback(
    (to: AgentState) => {
      try {
        machine.transition(to);
      } catch {
        machine.force(to);
      }
      setState(machine.current);
    },
    [machine],
  );

  const pushMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const cancelActive = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setPendingRisk(null);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelActive();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setHistoryOpen((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
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
  }, [cancelActive, go, state]);

  const speakText = async (text: string, signal?: AbortSignal) => {
    if (firstUseVoice) {
      setFirstUseVoice(false);
      pushMessage({
        id: crypto.randomUUID(),
        role: "system",
        text: "Primeiro uso de voz: áudio sintético mock (MiniMax real não conectado).",
      });
    }

    go("thinking");
    setBusy(true);
    try {
      if (signal?.aborted) throw new Error("aborted");
      const voice = new MockVoiceAdapter();
      const response = await voice.synthesize({
        voiceId: jarvisConfig.voice.voiceId,
        locale: jarvisConfig.voice.locale,
        audioFormat: jarvisConfig.voice.audioFormat,
        text,
        requestId: crypto.randomUUID(),
      });
      if (signal?.aborted) throw new Error("aborted");
      go("speaking");
      const audio = audioRef.current;
      if (audio) {
        audio.src = response.audioPath;
        await audio.play().catch(() => undefined);
      }
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
    if (!text || busy) return;

    if (requiresConfirmation(text)) {
      setPendingRisk(text);
      go("asking");
      return;
    }

    if (text.startsWith("/")) {
      setInput("");
      const handled = await runSlash(text);
      if (!handled) {
        pushMessage({
          id: crypto.randomUUID(),
          role: "system",
          text: `Comando desconhecido: ${text}`,
        });
      }
      return;
    }

    const provider = getProviderForAlias(modelAlias);
    if (!noticedProviders.current.has(provider)) {
      setFirstUseProvider(provider);
      go("asking");
      return;
    }

    await sendChat(text);
  };

  const sendChat = async (text: string) => {
    setInput("");
    pushMessage({ id: crypto.randomUUID(), role: "user", text });
    go("thinking");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const assistantId = crypto.randomUUID();
    let full = "";
    let sawDone = false;

    try {
      await streamChat(
        {
          alias: modelAlias,
          prompt: text,
          privacyClass,
          skills: activeSkills.length ? activeSkills : undefined,
          autoSelectSkills: activeSkills.length === 0,
          forceFallback,
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
          },
          onError: (error) => {
            throw new Error(error);
          },
        },
        controller.signal,
      );

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

  const provider = getProviderForAlias(modelAlias);

  return (
    <div className="relative flex h-dvh flex-col">
      <InstrumentBar
        privacyClass={privacyClass}
        modelAlias={modelAlias}
        provider={provider}
        spentUsd={spent}
        budgetUsd={BUDGET_USD}
        voiceOn={voiceOn}
        micPermission={micPermission}
      />

      <main className="relative flex flex-1 flex-col items-center justify-center px-4">
        <div className="h-[min(48vh,480px)] w-[min(48vh,480px)]">
          <PresenceField
            state={state}
            levelRef={levelRef}
            reducedMotion={reducedMotion}
            paused={documentHidden}
            webglAvailable={webglAvailable}
          />
        </div>

        <div className="mt-5 space-y-2">
          <StateLabel state={state} />
          <FallbackStrip
            visible={fallback.visible}
            requestedAlias={fallback.requestedAlias}
            effectiveAlias={fallback.effectiveAlias}
            reason={fallback.reason}
          />
        </div>

        <LastExchange messages={messages} />

        <button
          type="button"
          className="mt-4 text-xs text-ink-2 underline-offset-2 hover:text-ink-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-1"
          onClick={() => setHistoryOpen(true)}
        >
          histórico ^H ({messages.length})
        </button>
      </main>

      <Composer
        value={input}
        disabled={busy || Boolean(pendingRisk) || Boolean(firstUseProvider)}
        onChange={setInput}
        onSubmit={() => void handleSubmit()}
      />

      <HistoryPanel
        open={historyOpen}
        messages={messages}
        onClose={() => setHistoryOpen(false)}
      />

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
