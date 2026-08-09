# Safe-core UI completion design

Date: 2026-08-09  
Branch: `feat/safe-core-ui` (from `main` @ `a65a535`)  
Status: approved

## Goal

Finish Safe Agent Core Tasks 7.5–8: browser fetch-SSE client, deterministic UI reducer, flag-gated operational shell, verification report, E2E coverage, GitHub Project/milestone tracking, and PR to `main`.

## Context

- Tasks 1–7.4 are already on `main` / `origin/main` at `a65a535`.
- Local `codex/jarvis-evolution-core` matches that tip; remote evolution branch is stale at `f36360a`.
- `JARVIS-PROXIMOS-PASSOS.md` was partially stale on integration state; product remaining work is accurate.

## Architecture

- `page.tsx` selects `SafeJarvisShell` only when `JARVIS_SAFE_AGENT_CORE=1`; otherwise `JarvisShell` is exclusive.
- Browser uses `ensureSafeSession` → HttpOnly cookie + CSRF in `sessionStorage` only.
- Live updates and reload reconstruction both reduce persisted `SafeEventEnvelope`s.
- Sequence gaps are protocol errors: refetch snapshot, then reconnect with `Last-Event-ID`.
- Exact tool continuation stays in server process memory; UI shows sanitized approval fields only.

## Deliverables

1. Task 7.5 — `src/lib/safe-core-client.ts`, `src/ui/safe-run-reducer.ts` + Vitest.
2. Task 7.6 — `SafeJarvisShell`, selector, instrument bar, approval card, page flag switch.
3. Task 7.7 — focused + full verification, security review, task report.
4. Task 8 — Playwright coverage, GitHub Project `Jarvis Evolution`, milestone `M1 — Safe Agent Core`, PR.

## Explicit limitation

A pending approval may survive browser reload but not process restart, because exact continuation is not persisted.

## Non-goals

No new agent framework, ORM, AG-UI dependency, duplicate execution path, or optimistic sphere mutations from click/submit handlers.
