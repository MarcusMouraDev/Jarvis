# Jarvis V24 — Visual UX Design

**Branch:** `feat/v24-visual-ux` (from `main` @ `c4e0700`)  
**Status:** Approved in brainstorming (2026-08-09)  
**Related:** `DESIGN.md` (V23 → update to V24 on ship), `/Users/marcuspaulo/Projetos/jarvis-plano-incrementacao.md`, mockup `jarvis-imagem-final.png`

## Problem

Local `main` matches GitHub `origin/main`. The gap is product, not git: V23 UI is behind the V24 plan and the cinematic mockup. Surfaces collapse, neural presence is a single thin layer (220 / 1200), and known UX bugs (paste, palette, dialog focus, memory empty) remain. Safe-core landed a second shell path without a shared visual foundation.

## Goals

- Premium, cinematic instrument UI with **globe centered**.
- Visible **tokens** (separable surfaces) and **neural layers** (core / cortex / micro + orbits).
- Mockup supplies **atmosphere and density**, not a two-column dock layout.
- Same visual foundation for **`JarvisShell` and `SafeJarvisShell`**.
- Keep chat, voice, terminal, approvals, memory, and fallback intact.
- No API, shell-policy, or auth changes for visual effect.

## Non-goals (this PR)

- Full Playwright matrix (plan Task 8) — follow-up PR.
- Mockup bottom dock / two-column response layout.
- Custom MCP server (use published context-lens).
- New npm dependencies unless CSS/TS local solution fails.

## Decisions locked

| Decision | Choice |
|---|---|
| Visual north | Hybrid C: plan contracts + mockup atmosphere; globe stays center |
| Shells | Both (`JarvisShell` + `SafeJarvisShell`) |
| Approach | Shared foundation first (tokens, presence, hooks), shells consume |
| Scope | Plan tasks 0–4, 7 + critical fixes from 5–6 |
| Out of scope | Full e2e Task 8 |
| MCP | Install existing [cornelcroi/context-lens](https://github.com/cornelcroi/context-lens) |
| Branch | `feat/v24-visual-ux` → PR → merge later |

## Architecture

```
globals.css (tokens, elev, vignette)
        ↓
presence/ + presence-config (profiles, layered geometry, resolvePresenceVisual)
        ↓
hooks (use-webgl cache, use-dialog-focus)
        ↓
shared chrome (InstrumentBar, Composer, StateLabel, panels)
        ↓
JarvisShell  |  SafeJarvisShell   (orchestration only)
```

Z-order unchanged: vignette 0 → halo 10 → canvas 20 → chrome 30 → panels 40 → confirm 50.

## Visual system

### Tokens (Task 1)

Start from plan values; adjust only after visual check:

- `--color-surface-0..3`: oklch 0.105 / 0.155 / 0.215 / 0.285 @ hue ~252
- `--color-ink-0..2`, `--color-border`
- `--focus-ring`, `--state-danger`, `--state-success`
- `.elev-1..3` = surface + border + shadow + blur
- Body ≥ 14px; metadata 12px; micro 11px only for non-essential hints
- IBM Plex via `next/font/local` only if licensed `.woff2` files exist; else system fallback

### Presence layers (Task 3–4)

Profiles (deterministic Fibonacci geometry):

| Quality | core | cortex | micro | neighbors | maxEdges |
|---|---|---|---|---|---|
| mobile | 96 | 150 | 80 | 4 | 700 |
| balanced | 140 | 260 | 180 | 5 | 1400 |
| high | 220 | 420 | 300 | 6 | 2200 |

Selection: width < 640 or dpr > 2.25 → mobile; width ≥ 1280 and dpr ≤ 1.75 → high; else balanced. Reduced motion keeps density, disables pulse/rotation/attraction.

Radii: core ~0.72, cortex 1.00–1.15, micro 1.22–1.38. Shader uniforms: `uLayerOpacity`, `uPointScale`, `uTurbulence`. 2–3 low-opacity orbital rings. Fallback ≥ 24 CSS nodes + 6 links.

Chromatic contract (unchanged meaning):

| State | Hue behavior |
|---|---|
| idle | cold neutral, slow breath |
| listening | blue |
| thinking | amber / turbulence |
| speaking | cyan / audio-reactive |
| asking | red / slow pulse |
| failure | **no new hue** — keep previous colorA/B, desaturate, freeze structure |

`resolvePresenceVisual(state, previous)` encodes failure. Reduced motion: `frameloop="demand"` + `invalidate()` on state change so color updates without waiting on `useFrame`.

### Layout / chrome (Task 2 + 7)

- Globe center 42–58vmin desktop, ~34vmin tablet, 220–300px mobile
- `--instrument-height` via ResizeObserver on InstrumentBar
- Breakpoints: 360–639 sheet; 640–767 sheet; 768–1199 side ≤420px; ≥1200 chrome max ~960px
- Touch targets ≥ 44×44
- One open panel at a time; restore focus
- Vignette: state glow + depth gradient + subtle grain (never hurts text contrast)
- Motion: enter 180–240ms, press 140ms, no elastic bounce; hover only `@media (hover: hover) and (pointer: fine)`

## Critical UX fixes (subset of Tasks 5–6)

1. Global `Cmd/Ctrl+V`: do not `preventDefault` when target is editable.
2. Command palette: `runItem(item, shift)` on click — never stale `active`.
3. `useDialogFocus`: trap, Escape, restore; Confirm/Approval focus Cancel/Refuse first.
4. MemoryPanel: loading when `enabled === null`, error, disabled — never blank first paint.
5. Composer: visible cancel while busy/streaming.
6. `use-webgl`: detect once per mount; handle context lost → fallback; DPR `min(devicePixelRatio, 1.75)`.

## Error / degradation

- WebGL unavailable or context lost → PresenceFallback; controls + StateLabel stay usable.
- Audio error → keep text, show failure visual, return idle after feedback.
- No silent empty panels.

## Testing (this PR)

- Vitest: `getNeuralProfile`, edge caps, layered determinism, `resolvePresenceVisual` failure, palette `runItem`, webgl cache pure helper.
- After each group: targeted test + `npm run typecheck`.
- Exit gates: `npm test`, `typecheck`, `lint`, `build`.
- Full e2e Task 8 → next PR (must not regress existing e2e).

## Tooling

- RTK for noisy command output when useful.
- context-lens MCP (published): index local `jarvis` repo + plan doc for semantic search during implementation.
- Design skills during build: `ui-foundations` (tokens), `impeccable` (polish existing), `transitions-dev` (motion), `emil-design-eng` (microinteractions). Skip greenfield landing skills. `visual-critique` optional after screenshots.

## Success criteria

- Surfaces distinguishable without globe glow.
- High profile shows core / cortex / micro / orbits; mobile stays stable.
- Failure keeps prior hue and desaturates.
- Reduced motion updates state color immediately.
- Paste, palette click, dialog focus, memory states, cancel streaming work.
- Both shells share the same visual foundation.
- No security/API regressions.

## Delivery

1. Implement on `feat/v24-visual-ux` with checkpoints per group.
2. Update `DESIGN.md` to V24 (tokens + layers).
3. Open PR when asked; merge when asked.
4. Short report: files touched, tests run, hardware limits.
