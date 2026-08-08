# Jarvis V23 — presença viva

Este documento descreve somente o sistema visual. Para arquitetura e evolução segura, consulte [`docs/architecture/overview.md`](docs/architecture/overview.md) e [`docs/security/safe-agent-core.md`](docs/security/safe-agent-core.md).

## Sistema de estado cromático

| Estado | Cor | Comportamento visual |
|--------|-----|---------------------|
| `idle` | Neutro frio | Respiração quase imperceptível |
| `listening` | Azul | Deslocamento dirigido pelo microfone |
| `thinking` | Laranja | Turbulência interna, sem áudio |
| `speaking` | Ciano | Reativo à saída de voz (MiniMax mp3) |
| `asking` | Vermelho | Pulso lento, campo quase parado |
| `failure` | Sem cor nova | Congela o matiz anterior, perde coerência, dessatura |

**Colisão resolvida:** falha não é uma cor. Vermelho = "preciso de você" (pergunta ou confirmação de risco). Âmbar de fallback vive só na faixa textual, não na esfera.

**Regra:** cada estado tem rótulo textual visível (`StateLabel`). Cor e movimento nunca carregam significado sozinhos.

## Tokens (OKLCH)

Definidos em `src/app/globals.css` via `@theme`:

- superfícies: `--color-surface-0..3`
- tinta: `--color-ink-0..2`
- acentos: listen / think / ask / speak
- fallback textual: `--color-fallback`
- elevação: `--elev-1..3` (borda + sombra + blur)
- motion: `--ease-out`, `--ease-in-out`, `--ease-drawer`, `--dur-press|pop|panel`

A esfera usa uniforms hex derivados do mesmo sistema (`src/state/presence-config.ts`).
Vinheta e halo do shell leem `--state-glow` (hex de `colorA` do estado atual).

## Camadas (z)

| Camada | z | Conteúdo |
|--------|---|----------|
| Vinheta | 0 | Glow de fundo reativo ao estado |
| Halo | 10 | Aura ao redor do globo |
| Canvas | 20 | Rede neural WebGL |
| Chrome | 30 | Instrumento + composer |
| Painéis | 40 | Histórico, terminal, paleta |
| Confirmação | 50 | Overlay de risco / primeiro uso |

## Interação

- Atração do mouse no globo (pointer fine): neurônios próximos ao cursor puxam para fora; parallax discreto.
- Hover UI atrás de `@media (hover: hover) and (pointer: fine)`.
- Paleta `Cmd/Ctrl+K` abre sem animação (ação de teclado frequente).
- Spotlight em linhas de paleta/histórico via `--mx/--my` na própria linha.

## Acessibilidade e degradação

- `prefers-reduced-motion` checado em JS; **default SSR = reduzido**
- movimento reduzido → sem rotação/pulsos/atração; cor de estado preservada
- sem WebGL → fallback CSS neural
- laço pausado em aba oculta; DPR limitado a 1.75
- foco visível instantâneo; atalhos: `^H` histórico, `^V` voz, `^L` ouvir, `^K` paleta, `Esc` cancelar

Os controles operacionais e a política de ferramentas pertencem à [arquitetura](docs/architecture/overview.md) e à [segurança](docs/security/safe-agent-core.md).

## Áudio

- Entrada: `getUserMedia` → `AnalyserNode`
- Saída: mp3 → `<audio>` → `MediaElementAudioSourceNode` → `AnalyserNode`
- Nível lido por ref a cada frame, nunca `useState` a 60 Hz
- Permissão de microfone é estado de primeira classe: unknown / prompting / granted / denied / unavailable

## Instrumento

Privacidade, provedor efetivo e custo ficam na linha de instrumento — não na esfera.
