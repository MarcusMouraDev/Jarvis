# Jarvis V21 — presença viva

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

- superfícies: `--color-surface-0..2`
- tinta: `--color-ink-0..2`
- acentos: listen / think / ask / speak
- fallback textual: `--color-fallback`

A esfera usa uniforms hex derivados do mesmo sistema (`src/state/presence-config.ts`).

## Acessibilidade e degradação

- `prefers-reduced-motion` checado em JS; **default SSR = reduzido**
- movimento reduzido → frame estático (gradiente CSS), cor de estado preservada
- sem WebGL → mesmo fallback CSS
- laço pausado em aba oculta; DPR limitado a 1.75
- foco visível; atalhos: `^H` histórico, `^V` voz, `^L` ouvir, `Esc` cancelar

## Áudio

- Entrada: `getUserMedia` → `AnalyserNode`
- Saída: mp3 → `<audio>` → `MediaElementAudioSourceNode` → `AnalyserNode`
- Nível lido por ref a cada frame, nunca `useState` a 60 Hz
- Permissão de microfone é estado de primeira classe: unknown / prompting / granted / denied / unavailable

## Instrumento

Privacidade, provedor efetivo e custo ficam na linha de instrumento — não na esfera.
