# Hermes bridge surfaces — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Thin Jarvis HUD/API for Hermes capabilities the shell does not yet expose.

**Architecture:** Reuse `HermesGatewayClient` and `fetchHermesDashboard`. Bots and tools stay in Hermes. Jarvis maps events into the Safe Core store and HUD.

**Tech Stack:** Next.js 16, Vitest, existing CSRF/session security.

**Spec:** `docs/superpowers/specs/2026-08-25-hermes-bridge-surfaces-design.md`

## Global Constraints

- `JARVIS_SAFE_AGENT_CORE=1` for these routes.
- CSRF header `X-Jarvis-CSRF`; loopback Host/Origin.
- No secrets in events or logs.
- Mutating Hermes HTTP/RPC timeout ≥ 15s.
- Do not commit `graphify-out/`. Run `graphify update .` after the change.
- Do not push files past 1000 lines without extracting.

## Tasks

- [ ] Persist assistant on `run.completed` (idempotent per run)
- [ ] CUA install control in Ambiente
- [ ] `session.resume` from session HudMenu
- [ ] Attachments before `prompt.submit`
- [ ] `cron.manage` + AmbienteCron
- [ ] Messaging platforms proxy + AmbienteChannels
- [ ] Reducer subagents/clarify + SubagentRail
- [ ] TaskGraphPanel from skill JSON + tool events
- [ ] Vitest + graphify update
