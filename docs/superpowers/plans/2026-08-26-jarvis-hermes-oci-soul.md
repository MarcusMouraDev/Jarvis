# Jarvis Hermes OCI Soul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Jarvis + full Hermes capabilities on Oracle Cloud Always Free while enforcing a safe, original Jarvis response soul and preserving Jarvis-owned models and abilities.

**Architecture:** Jarvis is the private Tailscale UI, policy boundary, model broker, audit ledger, and personality layer. Hermes is a pinned ARM64 agent runtime reached through typed adapters. Docker Compose runs Jarvis, Hermes, and OmniRoute on an OCI A1 instance; a paired local companion supplies Mac-only capabilities.

**Tech Stack:** Next.js 16, TypeScript, React, Vitest, Playwright, Docker Compose, OpenTofu/Terraform, Oracle Cloud A1 ARM64, Tailscale, Hermes Agent, OmniRoute, Outlines/Pydantic evaluation.

**Spec:** `docs/superpowers/specs/2026-08-26-jarvis-hermes-oci-soul-design.md`

## Global Constraints

- Preserve every existing dirty change; reconcile it before changing shared code.
- Keep models and routing exclusively Jarvis-owned: OmniRoute, Gemini, Cursor, availability probes, approvals, and fallback policy.
- Hermes is capability/runtime source; no Hermes branding or model selector reaches the user-facing Jarvis UI.
- Never concatenate soul policy into user text, tool inputs, audit payloads, logs, or stored messages.
- `oci-a1-free` must never create paid OCI resources or silently downgrade security.
- Access is private through Tailscale; no raw Hermes, OmniRoute, or broker port is public.
- Use Outlines with Pydantic for new structured LLM evaluation output.
- Cursor-rule synchronization remains blocked until a non-empty source is supplied.

---

## Tasks

- [x] **1. Stabilize the current baseline.**
  - Preserve the existing Hermes bridge work and record its uncommitted baseline.
  - Fix the current ESLint errors/warnings and Turbopack dynamic-tracing warnings before adding deployment behavior.
  - Run `vitest`, typecheck, lint, production build, and existing safe E2E tests.

- [x] **2. Add the versioned Jarvis soul policy.**
  - Add `JarvisSoulPolicy`, explicit response-state protocol, preferences, digest, and provider-neutral compiler under `src/core/`.
  - Replace `modelContent()` in `src/core/safe-orchestrator.ts` with provider-native system-instruction construction.
  - Ensure user prompt/context, tool definitions, tool calls, results, and persisted records remain policy-free.
  - Add fixtures for normal, active-task, risky, failure, ambiguous, and casual responses.

- [x] **3. Carry the soul through every model path.**
  - Extend Safe Model adapters for native system instruction placement in Gemini, OpenAI-compatible/OmniRoute, and Cursor paths.
  - Add the same policy to the internal Hermes model broker, keyed by policy version and run digest.
  - Refuse mismatched policy digest on resumed runs; preserve deterministic historical replay.
  - Do not clone film dialogue, voice, or Marvel branding beyond the project's existing Jarvis name.

- [x] **4. Build personality evaluation and preferences.**
  - Add a small settings surface for compact, neutral, or formal delivery and preferred address.
  - Add deterministic compiler tests plus typed Outlines/Pydantic evaluation with `JarvisSoulRubric`.
  - Score accuracy, clarity, confidence calibration, anticipation, tact, restraint, and safety. Block releases on safety or accuracy regression, not on harmless wording variance.

- [ ] **5. Finish Hermes capability parity.**
  - Generate and version `HermesCapabilityManifest` from the pinned Hermes surface.
  - Map each capability to native VPS execution, Jarvis UI, or companion execution; fail CI on unmapped additions.
  - Complete existing bridge surfaces: sessions, attachments, approvals, subagents, clarifications, task graph, cron, messaging, memory, voice, computer use, plugins, skills, files, terminal, Git, profiles, and diagnostics.
  - Keep typed route facades; do not introduce a generic unvalidated HTTP proxy.

- [x] **6. Enforce Jarvis model authority.**
  - Add a private OpenAI-compatible model broker for Hermes.
  - Route every Hermes inference request to selected Jarvis aliases, including streaming, tool calls, fallbacks, cost policy, and cloud-egress consent.
  - Remove Hermes `auto/best-chat` fallback behavior and test that no Hermes-native model selection can surface.

- [ ] **7. Add companion-local execution.**
  - Define pairing, revocation, capability advertisement, heartbeat, idempotent job IDs, reconnect, and consent envelopes.
  - Route microphone, OS windows, `desktop_ui`, local notifications, and local automation only to a connected approved companion.
  - Make disconnect a visible unavailable state without losing server session state.

- [x] **8. Add portable Docker and OCI infrastructure.**
  - Create multi-stage `linux/arm64` and `linux/amd64` images for Jarvis and OmniRoute; use Hermes pinned multi-arch digest.
  - Add Compose profiles `oci-a1-free` and `standard-4x8`, healthchecks, internal networking, resource limits, queue settings, volumes, and secret mounts.
  - Add OpenTofu/Terraform plus cloud-init for OCI A1, 50 GB boot, 100 GB data, Tailscale, firewall, Docker, and non-root runtime user.
  - Validate free eligibility, shape, quotas, and region before apply. Treat unavailable A1 capacity as a blocked deployment, never a paid fallback.

- [x] **9. Add backup, recovery, and controlled updates.**
  - Back up Jarvis, Hermes, OmniRoute, and workspaces with encrypted Restic; retain 7 daily, 4 weekly, and 6 monthly snapshots.
  - Add companion-pulled off-instance backup and restore drill.
  - Pin all image digests and Hermes revision; update only after contract, ARM64, E2E, and restore tests pass. Roll back by digest and snapshot.

- [x] **10. Import Cursor rules when source exists.**
  - Source supplied and audited on 2026-08-26; imported rules retain attribution in `.cursor/rules/`.
  - Parse and classify rules into runtime policy, developer-only instructions, and unsupported items.
  - Implement only runtime-safe rules; preserve source attribution and add regression tests.
  - Current audit result: `/Users/marcuspaulo/Projetos/.cursor/rules`, `/Users/marcuspaulo/Projetos/jarvis/.cursor/rules`, `.cursorrules`, and `*.mdc` contain no files.

- [ ] **11. Validate release readiness.**
  - Run all existing tests, personality fixtures, typed rubric evaluation, capability contract tests, ARM64 image builds, and Compose E2E.
  - Run a 24-hour OCI-profile soak with one heavy run and one Chromium automation.
  - Test restart, persistence, backup/restore, total-instance loss, Tailscale-only access, companion loss, and model-provider failure.
  - Update Graphify after every code, config, docs, schema, or infrastructure change.

## Acceptance Criteria

- A response is accurate, calm, concise, anticipatory, tactful, and safety-preserving without copying MCU dialogue or voice.
- Persona is system-level, versioned, provider-consistent, and absent from user/tool/audit payloads.
- Hermes exposes every pinned capability through a mapped Jarvis or companion surface.
- Hermes cannot select models outside Jarvis policy.
- OCI A1 ARM64 runs the stack within 2 OCPU/12 GB limits, one heavy run at a time, with no public service port.
- A lost OCI instance can be recreated and restored from documented backups.
- No Cursor rule is claimed as imported until a real source file is provided.

## Execution checkpoint — 2026-08-26

Implemented: versioned soul/compiler, provider-native system placement, private Hermes broker, pinned capability manifest, multi-arch Dockerfile, OCI A1 OpenTofu/cloud-init, Compose profiles, encrypted Restic backup/restore scripts, and warning-free production build.

Pending validation: Docker/ARM64 image build, OCI soak/restore drill, full Hermes surface discovery, personality settings/rubric evaluation, companion pairing, and safe E2E rerun after the existing local Next dev server releases its port.

Local verification: `vitest` 400 passed / 0 failed / 1 skipped; TypeScript, ESLint, production build, Compose YAML and backup script syntax passed. Docker/OpenTofu CLIs are not installed in this workstation, so image/IaC apply were not claimed. Safe Playwright E2E was attempted but blocked by an existing Next dev server holding the development lock.

Follow-up verification (2026-08-27): `vitest` 450 passed / 0 failed / 1 skipped; TypeScript, ESLint, and production build passed; safe Playwright E2E 13 passed. The only output warnings were environment-level `NO_COLOR`/`FORCE_COLOR` and Node `DEP0190`; they did not affect test, lint, typecheck, or build outcomes.

Personality follow-up (2026-08-27): preferences, deterministic compiler, and the typed Outlines/Pydantic evaluator passed their focused checks. The evaluator schema self-test passed; running fixture scoring against a live model remains a release acceptance check requiring `JARVIS_EVAL_API_KEY` and a reachable broker.

Companion follow-up (2026-08-27): the desktop companion now executes the narrow `desktop_ui: show` capability locally, without a file grant. Electron companion tests are included in the default Vitest discovery; full regression passed 452 tests / 0 failures / 1 skipped, alongside TypeScript, ESLint, and production build. Microphone and local automation execution remain pending within task 7.
