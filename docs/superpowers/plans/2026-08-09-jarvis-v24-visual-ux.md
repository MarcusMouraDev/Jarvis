# Jarvis V24 Visual UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship shared V24 visual foundation (tokens, layered neural presence, chrome polish, critical a11y fixes) on `feat/v24-visual-ux` for both `JarvisShell` and `SafeJarvisShell`.

**Architecture:** Shared tokens + presence + hooks first; shells only orchestrate. Globe stays centered. Mockup = atmosphere/density only.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Three.js / R3F, Vitest, Playwright (smoke only this PR).

**Spec:** `docs/superpowers/specs/2026-08-09-jarvis-v24-visual-ux-design.md`

**Design skills in play:** `ui-foundations` (tokens), `impeccable` (polish existing), `transitions-dev` (panel/press motion + reduced-motion), `emil-design-eng` (microinteraction feel). Skip greenfield landing skills.

## Global Constraints

- No API / shell-policy / auth changes for visuals.
- Keep `StateLabel`, CSS fallback, `prefers-reduced-motion`, DPR cap, hidden-tab pause.
- No new npm deps if CSS/TS suffices.
- Touch targets ≥ 44×44; color never sole meaning.
- Failure never assigns fixed gray as primary hue — keep previous `colorA`/`colorB`, desaturate.
- Branch: `feat/v24-visual-ux`; commit per task group; no force-push to main.

## File map

| Area | Files |
|---|---|
| Tokens | `src/app/globals.css`, maybe `src/app/layout.tsx` |
| Presence | `src/presence/neural-geometry.ts`, `neural-geometry.test.ts`, `PresenceMesh.tsx`, `PresenceCanvas.tsx`, `shaders.ts`, `PresenceFallback.tsx`, `src/state/presence-config.ts` + new contrast/visual tests |
| Hooks | `src/hooks/use-webgl.ts` (+ test), `src/ui/use-dialog-focus.ts` (+ test) |
| Chrome | `InstrumentBar.tsx`, `Composer.tsx`, `StateLabel.tsx`, panels, `CommandPalette.tsx`, `ConfirmOverlay.tsx`, `ApprovalCard.tsx`, `JarvisShell.tsx`, `SafeJarvisShell.tsx` / Safe* peers |
| Docs | `DESIGN.md` |

---

### Task 0: Baseline

**Files:** none

- [ ] **Step 1:** `cd /Users/marcuspaulo/Projetos/jarvis && npm ci`
- [ ] **Step 2:** `npm test && npm run typecheck && npm run lint && npm run build` — all exit 0
- [ ] **Step 3:** Confirm on `feat/v24-visual-ux` tracking `origin/feat/v24-visual-ux`

---

### Task 1: Tokens (ui-foundations)

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx` only if local `.woff2` exist

**Produces:** separable `--color-surface-0..3`, ink, border, `--focus-ring`, `--state-danger`, `--state-success`, elev classes, focus-visible using `--focus-ring`

- [ ] **Step 1:** Update `@theme` surfaces/inks/border to plan values:

```css
--color-surface-0: oklch(0.105 0.028 252);
--color-surface-1: oklch(0.155 0.032 252);
--color-surface-2: oklch(0.215 0.035 252);
--color-surface-3: oklch(0.285 0.038 252);
--color-ink-0: oklch(0.97 0.012 250);
--color-ink-1: oklch(0.82 0.025 250);
--color-ink-2: oklch(0.70 0.025 250);
--color-border: oklch(0.34 0.035 252);
--focus-ring: oklch(0.82 0.16 205);
--state-danger: oklch(0.72 0.18 25);
--state-success: oklch(0.80 0.13 175);
```

- [ ] **Step 2:** Point `:focus-visible` at `var(--focus-ring)`; keep elev-1..3 pattern
- [ ] **Step 3:** `npm run typecheck` — PASS
- [ ] **Step 4:** Commit `style: separate jarvis surface tokens for v24`

---

### Task 2: Neural profiles + layered geometry (TDD)

**Files:**
- Modify: `src/presence/neural-geometry.ts`
- Modify: `src/presence/neural-geometry.test.ts`

**Produces:**

```ts
export type NeuralLayer = "core" | "cortex" | "micro";
export type NeuralQuality = "mobile" | "balanced" | "high";
export interface NeuralProfile {
  quality: NeuralQuality;
  coreCount: number;
  cortexCount: number;
  microCount: number;
  neighbors: number;
  maxEdges: number;
}
export interface LayeredNeuralGeometry {
  core: NeuralGeometry;
  cortex: NeuralGeometry;
  micro: NeuralGeometry;
  edges: NeuralEdge[];
}
export function getNeuralProfile(input: {
  width: number;
  dpr: number;
  reducedMotion: boolean;
}): NeuralProfile;
export function createLayeredNeuralGeometry(
  profile: NeuralProfile,
): LayeredNeuralGeometry;
```

Keep `createNeuralGeometry` for backward compat (or thin wrapper).

- [ ] **Step 1:** Write failing tests for profile selection + edge cap + determinism
- [ ] **Step 2:** Run `npx vitest run src/presence/neural-geometry.test.ts` — FAIL
- [ ] **Step 3:** Implement profiles + layered geometry (radii 0.72 / 1.0–1.15 / 1.22–1.38); edges across combined points with `maxEdges`
- [ ] **Step 4:** Tests PASS
- [ ] **Step 5:** Commit `feat: add layered neural geometry profiles`

---

### Task 3: resolvePresenceVisual + wire mesh/canvas

**Files:**
- Modify: `src/state/presence-config.ts`
- Create: `src/state/presence-visual.test.ts`
- Modify: `src/presence/PresenceMesh.tsx`, `PresenceCanvas.tsx`, `shaders.ts`, `PresenceFallback.tsx`

**Produces:**

```ts
export interface PresenceVisual {
  colorA: string;
  colorB: string;
  saturation: number;
  coherence: number;
  activation: number;
}
export function resolvePresenceVisual(
  state: AgentState,
  previous: PresenceVisual,
): PresenceVisual;
```

- [ ] **Step 1:** Failing test: failure keeps previous colors, lowers saturation/activation; thinking gets amber
- [ ] **Step 2:** Implement `resolvePresenceVisual`; stop treating `PRESENCE_BY_STATE.failure` gray as live hue source for shell glow
- [ ] **Step 3:** Mesh: 3 point layers + edge families + orbit rings; shaders get layer uniforms; reduced motion → demand + invalidate
- [ ] **Step 4:** Enrich PresenceFallback (≥24 nodes, 6 links)
- [ ] **Step 5:** `npx vitest run src/state/presence-visual.test.ts src/presence/neural-geometry.test.ts` + typecheck — PASS
- [ ] **Step 6:** Commit `feat: layered presence mesh and failure hue preserve`

---

### Task 4: Shell chrome + instrument height

**Files:**
- Modify: `src/ui/InstrumentBar.tsx`, `JarvisShell.tsx`, `SafeJarvisShell.tsx` (and SafeInstrumentBar if separate), panels, `Composer.tsx`, `globals.css`

- [ ] **Step 1:** ResizeObserver sets `--instrument-height` on shell root
- [ ] **Step 2:** Panels use `top: var(--instrument-height)`; touch `min-h-11 min-w-11`; single open panel
- [ ] **Step 3:** Safe shell gets same CSS vars / panel rules (shared classes)
- [ ] **Step 4:** typecheck PASS
- [ ] **Step 5:** Commit `fix: align shell chrome and instrument height`

---

### Task 5: Critical interaction fixes

**Files:**
- Modify: `JarvisShell.tsx`, `SafeJarvisShell.tsx`, `CommandPalette.tsx`, `ConfirmOverlay.tsx`, `ApprovalCard.tsx` / Safe peers, `Composer.tsx`, `MemoryPanel.tsx`
- Create: `src/ui/use-dialog-focus.ts`, `src/ui/command-palette-run.test.ts` (or extend existing)
- Modify: `src/hooks/use-webgl.ts` + test

- [ ] **Step 1:** Paste-safe `^V` (skip preventDefault on editable targets) in both shells
- [ ] **Step 2:** Palette `runItem(item, shift)` on click — unit test
- [ ] **Step 3:** `useDialogFocus`; Confirm/Approval focus Cancel/Refuse; no danger autofocus
- [ ] **Step 4:** MemoryPanel loading/error/disabled; Composer cancel while busy
- [ ] **Step 5:** use-webgl single detection + contextlost → fallback; DPR ≤ 1.75
- [ ] **Step 6:** tests + typecheck PASS
- [ ] **Step 7:** Commit `fix: harden paste palette focus memory and webgl`

---

### Task 6: Cinematic polish (impeccable + transitions-dev + emil)

**Files:**
- Modify: `globals.css`, `InstrumentBar.tsx`, `Composer.tsx`, `StateLabel.tsx`, `LastExchange.tsx`, `ToolCallCard.tsx`, `DESIGN.md`

- [ ] **Step 1:** Three-layer vignette + subtle grain; press scale ≤ 0.97; panel 240ms; reduced-motion instant opacity
- [ ] **Step 2:** Busy/success/error labels beyond color alone
- [ ] **Step 3:** Update `DESIGN.md` → V24 (tokens + layers)
- [ ] **Step 4:** `npm test && npm run typecheck && npm run lint && npm run build` — PASS
- [ ] **Step 5:** Commit `style: cinematic polish and design.md v24`

---

### Task 7: Tooling — context-lens

- [ ] **Step 1:** Add Cursor MCP entry for `uvx context-lens` in user MCP config
- [ ] **Step 2:** Index `/Users/marcuspaulo/Projetos/jarvis` (and plan path if supported)
- [ ] **Step 3:** Verify server discoverable (restart may be required)

---

## Self-review checklist

- Spec coverage: tokens, layers, both shells, critical fixes, polish, DESIGN.md, context-lens — mapped to tasks
- No Task 8 full e2e (explicit non-goal)
- Types: `NeuralProfile`, `LayeredNeuralGeometry`, `PresenceVisual`, `resolvePresenceVisual` consistent
- No placeholders

## Execution

User requested implement after design close → **inline execution** on `feat/v24-visual-ux` unless switched to subagents.
