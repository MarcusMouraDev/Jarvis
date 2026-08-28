# Jarvis Hermes OCI Soul — design

**Status:** Approved direction from product discussion; implementation remains pending.

## Goal

Run the complete Jarvis + Hermes experience on Oracle Cloud Always Free while making every assistant response feel like an original, operationally credible Jarvis: composed, observant, precise, anticipatory, tactful, quietly witty, and uncompromising about safety.

## Product decisions

- **Runtime:** Hermes remains the full agent runtime. Jarvis remains visual identity, consent, audit ledger, workspace policy, and model authority.
- **Models:** Jarvis owns OmniRoute, Gemini, Cursor, model availability, routing, fallback, and cloud-egress approval. Hermes never selects a model catalog independently.
- **VPS:** Oracle Always Free A1 is primary deployment target: Ubuntu 24.04 ARM64, 2 OCPUs, 12 GB RAM, Docker Compose, Tailscale-only user access, VPS-canonical state.
- **Device functions:** a local companion performs Mac-only work such as microphone, windows, `desktop_ui`, and local automation. It owns no canonical memory or provider secrets.
- **Film inspiration:** use JARVIS's operational traits from the MCU, not copyrighted dialogue, actor voice, catchphrases, or a claim of canonical Marvel affiliation.
- **Cursor rules:** no rule files currently exist in `/Users/marcuspaulo/Projetos/.cursor/rules` or `/Users/marcuspaulo/Projetos/jarvis/.cursor/rules`. Import is a gated task until the user supplies a source path or files.

## Jarvis soul

### Core posture

1. Protect the operator's attention, data, time, and agency.
2. Observe first; state confidence and missing information plainly.
3. Lead with conclusion or current operational state, then the smallest useful explanation.
4. Anticipate the next practical step without pretending to have acted.
5. Be respectful and warm under pressure, never theatrical or subservient.
6. Use restrained dry wit only when stakes are low and it improves clarity.

### Response protocol

| Situation | Required response shape |
| --- | --- |
| Normal question | answer; decisive recommendation; optional next step |
| Active task | current state; completed evidence; next action; blocker only when real |
| Risky action | consequence; exact approval requested; safe alternative |
| Failure | fact; impact; recovery path; no blame or invented certainty |
| Ambiguous request | concise clarification with material options; do not infer destructive authority |
| Social exchange | brief, composed, human enough to be pleasant; return to useful context |

### Boundaries

- Never claim an action, observation, integration, or external state that did not occur.
- Never weaken consent, privacy, cost, workspace, or security policy for style.
- Never manufacture urgency, dependency, emotional attachment, or personal authority.
- Never use sarcasm during failures, safety incidents, money decisions, sensitive topics, or approval flows.
- Do not put persona text inside tool arguments, structured payloads, audit events, or user-owned content.
- Address in Brazilian Portuguese by default; use formal respectful address only when it reads naturally. Support a user preference for compact, neutral, or formal delivery.

## Technical design

### Soul policy

Introduce a versioned `JarvisSoulPolicy` with:

- identity and language defaults;
- behavioral principles and prohibited behaviors;
- response protocol by state;
- style level and preferred address;
- prompt version and integrity digest.

`JarvisPromptCompiler` produces provider-native system instructions. OpenAI-compatible providers receive a `system` message, Gemini receives `systemInstruction`, and Cursor receives its supported instruction channel. User prompt, workspace context, tool definitions, tool results, and approval payloads remain separate.

The current `modelContent()` prefix in `src/core/safe-orchestrator.ts` is replaced; it must not concatenate policy text into the user message. The Hermes model broker applies the same compiled policy so local Safe Core and Hermes turns have identical behavioral rules.

### Evaluation

- Unit tests assert deterministic compilation, provider-specific placement, digesting, and no policy leakage into tool inputs or persisted user text.
- Scenario fixtures cover normal, risky, failure, uncertain, urgent, and casual exchanges.
- LLM quality evaluation produces a typed `JarvisSoulRubric` via Outlines/Pydantic; no regex parses free-form evaluator output.
- Rubric dimensions: accuracy, operational clarity, calibrated confidence, anticipation, tact, restraint, and safety preservation.

## Oracle Cloud Always Free profile

- `oci-a1-free` is ARM64 and deliberately lower-CPU than the original 4 vCPU/8 GB target. Build in CI or local ARM hardware; VPS only pulls digests.
- Run one heavy agent task and one browser automation at a time. Queue extra work.
- Budget Hermes 4.5 GB, Jarvis 1.5 GB, OmniRoute 1.5 GB; reserve remaining memory for Ubuntu, Chromium, and cache. Use 2 GB zram only for bursts.
- Use 50 GB boot plus 100 GB data volume, leaving quota for recovery. Keep encrypted Restic backups and an off-instance copy pulled by the companion through Tailscale.
- Capacity and idle reclamation are operational risks. IaC must never fall through to paid OCI resources; recovery rebuilds from pinned image digests and backups.

Oracle's current Always Free documentation states 2 OCPUs and 12 GB for Ampere A1, 200 GB of block volume, possible capacity exhaustion, and idle-instance reclamation criteria. See [Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm) and [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). Google permanent free Compute is an e2-micro with 1 GB; Azure's free B2pts/B2ats offer 2 vCPU/1 GB; AWS can provide `m7i-flex.large` with 2 vCPU/8 GB only under time-limited credits. See [Google](https://cloud.google.com/free), [Azure](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/create-free-services), and [AWS](https://aws.amazon.com/free/).

## Compatibility contract

Generate a pinned `HermesCapabilityManifest`; every capability maps to `vps-native`, `jarvis-ui`, or `companion-local`. CI fails when an Hermes update has no mapping. Models are intentionally excluded from Hermes ownership. Jarvis-only capabilities remain available and win on presentation and safety whenever features overlap.
