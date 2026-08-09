# Jarvis V24 — presença viva

Este documento descreve somente o sistema visual. Para arquitetura e evolução segura, consulte [`docs/architecture/overview.md`](docs/architecture/overview.md) e [`docs/security/safe-agent-core.md`](docs/security/safe-agent-core.md).

## Sistema de estado cromático

| Estado | Cor | Comportamento visual |
|--------|-----|---------------------|
| `idle` | Neutro frio | Respiração quase imperceptível |
| `listening` | Azul | Deslocamento dirigido pelo microfone |
| `thinking` | Laranja | Turbulência interna, sem áudio |
| `speaking` | Ciano | Reativo à saída de voz (MiniMax mp3) |
| `asking` | Vermelho | Pulso lento, campo quase parado |
| `failure` | Sem cor nova | Congela o matiz anterior via `resolvePresenceVisual`, perde coerência, dessatura |

**Colisão resolvida:** falha não é uma cor. Vermelho = "preciso de você" (pergunta ou confirmação de risco). Âmbar de fallback vive só na faixa textual, não na esfera.

**Regra:** cada estado tem rótulo textual visível (`StateLabel`). Cor e movimento nunca carregam significado sozinhos.

## Tokens (OKLCH)

Definidos em `src/app/globals.css` via `@theme`:

- superfícies: `--color-surface-0..3` (0.105 → 0.285, separáveis)
- tinta: `--color-ink-0..2`
- foco / semântica: `--focus-ring`, `--state-danger`, `--state-success`
- acentos: listen / think / ask / speak
- elevação: `--elev-1..3` (borda + sombra + blur)
- layout: `--instrument-height` (ResizeObserver na InstrumentBar)
- motion: `--ease-out`, `--ease-in-out`, `--ease-drawer`, `--dur-press|pop|panel`

A esfera usa uniforms hex derivados do mesmo sistema (`src/state/presence-config.ts`).
Vinheta e halo do shell leem `--state-glow` (hex de `colorA` do visual resolvido).

## Presença em camadas

Perfis `mobile` / `balanced` / `high` via `getNeuralProfile` → `createLayeredNeuralGeometry`:

- **core** ~raio 0.72
- **cortex** 1.00–1.15
- **micro** 1.22–1.38 (menor `uPointScale` / `uLayerOpacity`)
- órbitas CSS/Three discretas de baixa opacidade
- fallback CSS ≥ 24 nós + 6 ligações

## Camadas (z)

| Camada | z | Conteúdo |
|--------|---|----------|
| Vinheta | 0 | Glow + profundidade + grain sutil |
| Halo | 10 | Aura ao redor do globo |
| Canvas | 20 | Rede neural WebGL em camadas |
| Chrome | 30 | Instrumento + composer |
| Painéis | 40 | Histórico, terminal, paleta |
| Confirmação | 50 | Overlay de risco / primeiro uso |

## Interação

- Atração do mouse no globo (pointer fine): neurônios próximos ao cursor puxam para fora; parallax discreto.
- Hover UI atrás de `@media (hover: hover) and (pointer: fine)`.
- Paleta `Cmd/Ctrl+K` — `runItem(item)` no clique (sem índice stale).
- `Cmd/Ctrl+V` não intercepta paste em campos editáveis.
- Confirmação/aprovação: foco inicial em Cancelar/Recusar.
- Composer: botão Parar enquanto `busy`.

## Acessibilidade e degradação

- `prefers-reduced-motion` checado em JS; **default SSR = reduzido**
- movimento reduzido → `frameloop="demand"` + `invalidate()` na troca de estado; cor preservada
- sem WebGL / context lost → fallback CSS neural
- laço pausado em aba oculta; DPR limitado a 1.75
- `useDialogFocus` em dialogs; touch ≥ 44×44
- foco visível via `--focus-ring`

## Áudio

- Entrada: `getUserMedia` → `AnalyserNode`
- Saída: mp3 → `<audio>` → `MediaElementAudioSourceNode` → `AnalyserNode`
- Nível lido por ref a cada frame, nunca `useState` a 60 Hz
- Permissão de microfone é estado de primeira classe: unknown / prompting / granted / denied / unavailable

## Instrumento

Privacidade, provedor efetivo e custo ficam na linha de instrumento — não na esfera.
`JarvisShell` e `SafeJarvisShell` compartilham tokens, presença e chrome foundation.
