# Safe-core API, Replayable SSE and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the safe agent core through loopback-only protected APIs and a replayable event stream, then add a flag-gated operational UI whose state can be reconstructed from SQLite after a browser reload.

**Architecture:** Keep the V23 `JarvisShell` untouched when `JARVIS_SAFE_AGENT_CORE=0`; the server page selects a separate `SafeJarvisShell` when the flag is exactly `1`. A server-only `SafeCoreRuntime` composes the existing catalog, SQLite store, tool gateway, model adapters and orchestrator. Thin Next.js route handlers call a testable application service, while an SQLite-polling SSE stream emits only already-persisted versioned envelopes. The client uses fetch-based SSE so it can send the CSRF header and reduces persisted events into messages, presence state, effective model and approval state.

**Tech Stack:** Next.js 16 App Router route handlers, React 19, TypeScript 5.9, Zod 4, better-sqlite3, Vitest, existing CSS/Tailwind tokens.

## Global Constraints

- Base verified at `d35ac2028a37a1ad6742e3f71dfe0c02a63d152b`; work only on `codex/jarvis-evolution-core`.
- Apply Ponytail: reuse existing Next.js, Zod, YAML, better-sqlite3, Vitest and Playwright; no agent framework, ORM, AG-UI dependency, or duplicate execution path.
- Preserve V23 memory, scheduler, browser and legacy behavior while `JARVIS_SAFE_AGENT_CORE=0`.
- When `JARVIS_SAFE_AGENT_CORE=1`, all side effects go through the Tool Gateway; no legacy executor may bypass it.
- Never expose secrets, local paths, exploit details, raw prompts, or provider credentials in public documentation, issues, events, or logs.
- Implement test-first for security and state-machine behavior; all filesystem tests use an injected temporary `JARVIS_DATA_DIR`.
- Each task must be committed independently, self-reviewed, and accompanied by targeted verification evidence.
- Paid providers remain disabled unless a run explicitly opts in; there is no automatic local-to-cloud fallback.
- The approval UI may display only sanitized target, effect, preview/diff and expiry. Exact raw continuation data stays in server process memory and is never emitted to the browser or persisted in events.

---

## File Structure

- `src/core/safe-api-contract.ts`: browser-safe Zod request schemas and versioned response/event types.
- `src/core/safe-event-protocol.ts`: SQLite event-to-envelope mapping, SSE encoding and abortable replay/poll stream.
- `src/core/safe-core-service.ts`: authorization-independent application operations over a session, catalog, store and orchestrator.
- `src/core/safe-core-runtime.ts`: server-only singleton composition and in-process exact continuation custody.
- `src/core/core-store.ts`: session default update and session-bound run/read-model queries.
- `src/core/safe-orchestrator.ts`: retain exact pending continuation in memory and resume by invocation identifier.
- `src/app/api/session/bootstrap/route.ts`: existing bootstrap plus protected default-agent update.
- `src/app/api/agents/route.ts`: protected catalog read API.
- `src/app/api/workspaces/route.ts`: protected, path-free project choice API.
- `src/app/api/runs/route.ts`: legacy GET when the flag is off; protected safe GET/POST when on.
- `src/app/api/runs/[runId]/route.ts`: protected run snapshot.
- `src/app/api/runs/[runId]/cancel/route.ts`: protected cancellation.
- `src/app/api/runs/[runId]/events/route.ts`: protected fetch-based SSE with replay.
- `src/app/api/approvals/[approvalId]/route.ts`: protected exact approval decision and same-run resume.
- `src/lib/safe-core-client.ts`: bootstrap/session storage, protected fetch and fetch-SSE parser.
- `src/ui/safe-run-reducer.ts`: pure persisted-event reducer used for live updates and reload reconstruction.
- `src/ui/SafeAgentSelector.tsx`: Hermes-default selector disabled for an active run.
- `src/ui/SafeApprovalCard.tsx`: accessible inline disclosure with sanitized approval detail.
- `src/ui/SafeInstrumentBar.tsx`: selected agent, privacy, effective provider/model and run status.
- `src/ui/SafeJarvisShell.tsx`: safe-mode orchestration UI; no legacy execution imports.
- `src/app/page.tsx`: server-side flag switch between legacy and safe shells.
- `src/app/globals.css`: focused safe-shell layout and reduced-motion-aware disclosure transitions.

### Task 7.1: Persistence read models and exact in-process continuation

**Files:**
- Modify: `src/core/core-store.ts`
- Modify: `src/core/core-store.test.ts`
- Modify: `src/core/safe-orchestrator.ts`
- Modify: `src/core/safe-orchestrator.test.ts`

**Interfaces:**
- Consumes: `CoreStore.getSession`, `CoreStore.getRun`, `CoreStore.replayEvents`, `SafeModelOrchestrator.resumeTool`.
- Produces: `updateSessionDefaultAgent(sessionId, agentId)`, `listRunsForSession(sessionId, limit)`, `listMessagesForRun(sessionId, runId)`, `listApprovalsForRun(sessionId, runId)`, `sequenceForEvent(runId, eventId)`, `SafeModelOrchestrator.hasPendingContinuation(...)`, and `resumePendingTool(...)`.

- [ ] **Step 1: Write failing CoreStore read-model tests**

```ts
expect(store.listRunsForSession(session.sessionId, 1)).toEqual([newestRun]);
expect(store.listMessagesForRun(session.sessionId, run.runId)).toEqual([message]);
expect(store.listApprovalsForRun(session.sessionId, run.runId)).toEqual([approval]);
expect(store.sequenceForEvent(run.runId, event.eventId)).toBe(event.seq);
expect(() => store.updateSessionDefaultAgent(session.sessionId, "Planner")).not.toThrow();
```

- [ ] **Step 2: Run the focused store test and verify RED**

Run: `npx vitest run src/core/core-store.test.ts`

Expected: FAIL because the five read-model methods do not exist.

- [ ] **Step 3: Implement parameterized, session-bound SQLite queries**

```ts
updateSessionDefaultAgent(sessionId: string, agentId: string): CoreSession;
listRunsForSession(sessionId: string, limit = 20): CoreRun[];
listMessagesForRun(sessionId: string, runId: string): CoreMessage[];
listApprovalsForRun(sessionId: string, runId: string): SafeToolApproval[];
sequenceForEvent(runId: string, eventId: string): number | null;
```

Cap `limit` to `1..100`, order runs newest-first, messages/approvals oldest-first, and join through `runs.session_id` so cross-session identifiers return empty/null.

- [ ] **Step 4: Write failing orchestrator continuation tests**

```ts
expect(orchestrator.hasPendingContinuation({ sessionId, runId, invocationId })).toBe(true);
await orchestrator.resumePendingTool({ sessionId, runId, invocationId });
expect(gateway.resume).toHaveBeenCalledWith({ sessionId, runId, invocationId, input: exactToolInput });
expect(JSON.stringify(store.replayEvents(runId))).not.toContain(JSON.stringify(exactToolInput));
```

Also assert mismatched session/run IDs fail closed, cancellation clears the continuation, and a second resume returns `continuation_unavailable`.

- [ ] **Step 5: Run the focused orchestrator test and verify RED**

Run: `npx vitest run src/core/safe-orchestrator.test.ts`

Expected: FAIL because pending-continuation custody is not implemented.

- [ ] **Step 6: Add exact continuation custody without event exposure**

```ts
interface PendingContinuation {
  sessionId: string;
  runId: string;
  invocationId: string;
  toolInput: JsonValue;
  prompt: string;
  context: JsonValue;
}

hasPendingContinuation(binding: Pick<PendingContinuation, "sessionId" | "runId" | "invocationId">): boolean;
resumePendingTool(binding: Pick<PendingContinuation, "sessionId" | "runId" | "invocationId">): Promise<SafeOrchestratorResult>;
discardPendingContinuation(binding: Pick<PendingContinuation, "sessionId" | "runId" | "invocationId">): void;
```

Store the exact continuation immediately before returning `approval_required`; persist only digests plus sanitized preview. Clear it after consumption, denial, cancellation or terminal failure. Keep `resumeTool` as the lower-level exact-binding verifier.

- [ ] **Step 7: Run Task 7.1 tests and commit**

Run: `npx vitest run src/core/core-store.test.ts src/core/safe-orchestrator.test.ts`

Expected: PASS.

Commit: `git commit -m "feat: add safe-core read models"`

### Task 7.2: Versioned API contracts and application service

**Files:**
- Create: `src/core/safe-api-contract.ts`
- Create: `src/core/safe-api-contract.test.ts`
- Create: `src/core/safe-core-service.ts`
- Create: `src/core/safe-core-service.test.ts`

**Interfaces:**
- Consumes: Task 7.1 store methods, catalog/workspace policy, `SafeToolGateway.decideApproval`, orchestrator execute/cancel/resume methods.
- Produces: validated API inputs, `SafeRunSnapshot`, agent/workspace summaries and `SafeCoreService` operations used by every route.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(createRunRequestSchema.parse({
  prompt: "analise o projeto",
  agentId: "Hermes",
  privacyClass: "internal",
  workspace: { kind: "none" },
})).toMatchObject({ agentId: "Hermes" });
expect(() => createRunRequestSchema.parse({ prompt: "", workspace: { kind: "existing", name: "../x" } })).toThrow();
expect(eventEnvelopeSchema.parse(envelope).v).toBe(1);
```

Cover strict objects, prompt length, the four agent IDs, privacy classes, workspace names, decisions, optional paid-provider opt-in and finite positive timeout/nonnegative budget.

- [ ] **Step 2: Run contract tests and verify RED**

Run: `npx vitest run src/core/safe-api-contract.test.ts`

Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement strict schemas and public types**

```ts
export const createRunRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(32_000),
  agentId: agentIdSchema.optional(),
  privacyClass: privacyClassSchema.default("internal"),
  workspace: publicWorkspaceRequestSchema.default({ kind: "none" }),
  allowPaidProvider: z.boolean().default(false),
  maxCostUsd: z.number().finite().nonnegative().optional(),
  timeoutMs: z.number().int().positive().optional(),
}).strict();

export interface SafeEventEnvelope {
  v: 1;
  eventId: string;
  runId: string;
  seq: number;
  ts: string;
  type: string;
  payload: JsonValue;
}
```

- [ ] **Step 4: Write failing service tests with fake orchestrator and temporary store**

```ts
const created = await service.createRun(session, request);
expect(created.run.agentId).toBe("Hermes");
expect(created.run.workspace).toEqual({ kind: "none" });
expect(execute).toHaveBeenCalledWith(expect.objectContaining({ runId: created.run.runId }));
expect(service.getRunSnapshot(otherSession, created.run.runId)).toBeNull();
```

Also cover default-agent update, catalog summaries, path-free workspace names, agent/workspace incompatibility, immutable run agent, safe cancellation, approval denial, approval approval plus same-run continuation, unavailable continuation before decision, and snapshot reconstruction from stored messages/events/approvals.

- [ ] **Step 5: Run service tests and verify RED**

Run: `npx vitest run src/core/safe-core-service.test.ts`

Expected: FAIL because `SafeCoreService` does not exist.

- [ ] **Step 6: Implement the service boundary**

```ts
export class SafeCoreService {
  updateDefaultAgent(session: CoreSession, input: unknown): CoreSession;
  listAgents(): SafeAgentSummary[];
  listWorkspaces(session: CoreSession): SafeWorkspaceChoice[];
  listRuns(session: CoreSession, limit?: number): SafeRunSummary[];
  createRun(session: CoreSession, input: unknown): Promise<SafeRunSnapshot>;
  getRunSnapshot(session: CoreSession, runId: string): SafeRunSnapshot | null;
  cancelRun(session: CoreSession, runId: string): SafeRunSnapshot | null;
  decideApproval(session: CoreSession, approvalId: string, input: unknown): Promise<SafeRunSnapshot>;
}
```

The service resolves and freezes the workspace only during run creation, persists the user message before orchestration, appends `run.created`, starts the orchestrator asynchronously with a handled rejection, and converts all absolute workspace data to stable labels before returning a response.

- [ ] **Step 7: Run Task 7.2 tests and commit**

Run: `npx vitest run src/core/safe-api-contract.test.ts src/core/safe-core-service.test.ts`

Expected: PASS.

Commit: `git commit -m "feat: add safe-core application service"`

### Task 7.3: Runtime composition and protected route handlers

**Files:**
- Create: `src/core/safe-core-runtime.ts`
- Create: `src/core/safe-core-runtime.test.ts`
- Modify: `src/app/api/session/bootstrap/route.ts`
- Modify: `src/app/api/session/bootstrap/route.test.ts`
- Create: `src/app/api/agents/route.ts`
- Create: `src/app/api/workspaces/route.ts`
- Modify: `src/app/api/runs/route.ts`
- Create: `src/app/api/runs/route.test.ts`
- Create: `src/app/api/runs/[runId]/route.ts`
- Create: `src/app/api/runs/[runId]/cancel/route.ts`
- Create: `src/app/api/approvals/[approvalId]/route.ts`
- Create: `src/app/api/safe-routes.test.ts`

**Interfaces:**
- Consumes: `SafeCoreService`, `requireProtectedRequest`, existing adapters/gateway/orchestrator and the legacy run-ledger GET behavior.
- Produces: singleton production runtime and all JSON APIs except SSE.

- [ ] **Step 1: Write failing runtime tests**

```ts
expect(createSafeCoreRuntime({ env: { JARVIS_LOCAL_MODEL: "qwen" }, store }).service).toBeDefined();
expect(() => runtime.orchestratorFor("local")).not.toThrow();
expect(() => runtime.orchestratorFor("local", {})).toThrow("model_adapter_unavailable");
```

Assert paid adapters are constructed only when their model configuration exists and that model credentials are read only when a provider request executes.

- [ ] **Step 2: Run runtime tests and verify RED**

Run: `npx vitest run src/core/safe-core-runtime.test.ts`

Expected: FAIL because runtime composition does not exist.

- [ ] **Step 3: Compose the server-only runtime**

```ts
export interface SafeCoreRuntime {
  store: CoreStore;
  catalog: AgentCatalog;
  gateway: SafeToolGateway;
  orchestrator: SafeModelOrchestrator;
  service: SafeCoreService;
}

export function getSafeCoreRuntime(): SafeCoreRuntime;
export function resetSafeCoreRuntimeForTests(): void;
```

Instantiate local/cloud adapters only when their required model IDs are configured. Keep default local routing and never invent a cloud fallback.

- [ ] **Step 4: Write failing route tests**

```ts
expect((await agentsGET(protectedRequest())).status).toBe(200);
expect((await runsPOST(unprotectedRequest())).status).toBe(401);
expect((await runsPOST(protectedRequest({ body: validRun }))).status).toBe(202);
expect((await cancelPOST(protectedRequest(), context(runId))).status).toBe(200);
expect((await approvalPOST(protectedRequest({ body: { decision: "approved" } }), context(id))).status).toBe(200);
```

Cover safe flag off, Host/Origin, CSRF, invalid JSON/schema, unknown/cross-session IDs, path-free responses, status codes, and legacy `/api/runs` GET preservation when the flag is off.

- [ ] **Step 5: Run route tests and verify RED**

Run: `npx vitest run src/app/api/session/bootstrap/route.test.ts src/app/api/runs/route.test.ts src/app/api/safe-routes.test.ts`

Expected: FAIL for missing handlers and update method.

- [ ] **Step 6: Implement thin protected handlers**

```ts
const auth = requireProtectedRequest(request, { store: runtime.store });
if (!auth.ok) return auth.response;
return Response.json(await runtime.service.createRun(auth.session, await request.json()), { status: 202 });
```

Use awaited `RouteContext` params in Next.js 16 dynamic routes. Add `PATCH /api/session/bootstrap` for `defaultAgentId`; keep the existing bootstrap GET and strict cookie unchanged.

- [ ] **Step 7: Run Task 7.3 tests and commit**

Run: `npx vitest run src/core/safe-core-runtime.test.ts src/app/api/session/bootstrap/route.test.ts src/app/api/runs/route.test.ts src/app/api/safe-routes.test.ts`

Expected: PASS.

Commit: `git commit -m "feat: expose protected safe-core APIs"`

### Task 7.4: Replayable persisted SSE

**Files:**
- Create: `src/core/safe-event-protocol.ts`
- Create: `src/core/safe-event-protocol.test.ts`
- Create: `src/app/api/runs/[runId]/events/route.ts`
- Create: `src/app/api/runs/[runId]/events/route.test.ts`

**Interfaces:**
- Consumes: `CoreStore.replayEvents`, `CoreStore.sequenceForEvent`, protected session binding.
- Produces: `toSafeEventEnvelope`, `encodeSseEnvelope`, `streamStoredEvents` and protected event route.

- [ ] **Step 1: Write failing protocol tests with injected clock/wait**

```ts
expect(toSafeEventEnvelope(event)).toEqual({
  v: 1, eventId: event.eventId, runId: event.runId, seq: event.seq,
  ts: event.createdAt, type: event.type, payload: event.payload,
});
expect(encodeSseEnvelope(envelope)).toContain(`id: ${event.eventId}\n`);
expect(encodeSseEnvelope(envelope)).toContain(`data: ${JSON.stringify(envelope)}\n\n`);
```

Prove replay starts strictly after the supplied event, every emitted data envelope already exists in SQLite, a heartbeat comment is emitted after exactly the injected 15-second interval, terminal runs close after their final stored event, and abort cancels polling.

- [ ] **Step 2: Run protocol tests and verify RED**

Run: `npx vitest run src/core/safe-event-protocol.test.ts`

Expected: FAIL because the protocol module does not exist.

- [ ] **Step 3: Implement persisted replay and streaming**

```ts
export function streamStoredEvents(options: {
  store: CoreStore;
  runId: string;
  afterSeq: number;
  signal: AbortSignal;
  heartbeatMs?: number;
  pollMs?: number;
  now?: () => Date;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): ReadableStream<Uint8Array>;
```

Use `heartbeatMs = 15_000` and a short bounded SQLite poll. Do not emit an event until it has been returned by `replayEvents`.

- [ ] **Step 4: Write failing event-route tests**

```ts
expect(response.headers.get("content-type")).toContain("text/event-stream");
expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
expect(replayedIds).toEqual([second.eventId, third.eventId]);
expect(protocolError.type).toBe("protocol.error");
```

Cover missing/cross-run `Last-Event-ID`, cross-session run access, required CSRF header and no CORS header.

- [ ] **Step 5: Implement `Last-Event-ID` validation and protocol errors**

For an invalid replay cursor, append `{ code: "invalid_last_event_id" }` as `protocol.error` before emitting that envelope and close the stream. Unknown or cross-session runs return 404 without revealing existence.

- [ ] **Step 6: Run Task 7.4 tests and commit**

Run: `npx vitest run src/core/safe-event-protocol.test.ts src/app/api/runs/[runId]/events/route.test.ts`

Expected: PASS.

Commit: `git commit -m "feat: add replayable safe-core events"`

### Task 7.5: Fetch-SSE client and deterministic UI reducer

**Files:**
- Create: `src/lib/safe-core-client.ts`
- Create: `src/lib/safe-core-client.test.ts`
- Create: `src/ui/safe-run-reducer.ts`
- Create: `src/ui/safe-run-reducer.test.ts`

**Interfaces:**
- Consumes: Task 7.2 API contracts and Task 7.4 SSE envelope.
- Produces: protected browser client, incremental SSE parser and a pure UI state reducer.

- [ ] **Step 1: Write failing fetch-SSE parser tests**

```ts
const events = await collect(parseSafeEventStream(chunksSplitAcrossUtf8Boundaries));
expect(events.map((event) => event.eventId)).toEqual(["event-1", "event-2"]);
expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({
  headers: expect.objectContaining({ "X-Jarvis-CSRF": token, "Last-Event-ID": "event-1" }),
}));
```

Cover heartbeat comments, multiline chunks, malformed JSON as a typed protocol failure, abort and CSRF session-storage bootstrap reuse.

- [ ] **Step 2: Run client tests and verify RED**

Run: `npx vitest run src/lib/safe-core-client.test.ts`

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement the protected client**

```ts
export async function ensureSafeSession(): Promise<SafeSessionClient>;
export async function safeCoreFetch(path: string, init?: RequestInit): Promise<Response>;
export async function* streamRunEvents(runId: string, lastEventId: string | null, signal: AbortSignal): AsyncIterable<SafeEventEnvelope>;
```

Store only the CSRF token and expiry in `sessionStorage`; the opaque session remains exclusively in the HttpOnly cookie.

- [ ] **Step 4: Write failing reducer tests**

```ts
const reloaded = reduceSafeRun(snapshot.events);
const live = snapshot.events.reduce(applySafeEvent, initialSafeRunState());
expect(reloaded).toEqual(live);
expect(reloaded.presence).toBe("asking");
expect(reloaded.effectiveModel).toEqual({ provider: "local", model: "qwen" });
```

Cover `run.created`, `model.selected`, `text.delta`, `model.retry`, `tool.approval_required`, `tool.completed`, `run.completed`, `run.failed`, `abort`, `protocol.error`, duplicate event IDs and sequence gaps.

- [ ] **Step 5: Implement a pure event-sourced UI state**

```ts
export interface SafeRunUiState {
  lastEventId: string | null;
  lastSeq: number;
  presence: AgentState;
  assistantText: string;
  effectiveModel: { provider: string; model: string } | null;
  pendingApproval: SafeApprovalView | null;
  fallback: { from: string; to: string; reason: string } | null;
  protocolError: string | null;
}
```

Only backend envelopes may change `presence`; submit/click handlers never set sphere state optimistically.

- [ ] **Step 6: Run Task 7.5 tests and commit**

Run: `npx vitest run src/lib/safe-core-client.test.ts src/ui/safe-run-reducer.test.ts`

Expected: PASS.

Commit: `git commit -m "feat: add safe-core event client"`

### Task 7.6: Safe operational shell

**Files:**
- Create: `src/ui/SafeAgentSelector.tsx`
- Create: `src/ui/SafeApprovalCard.tsx`
- Create: `src/ui/SafeInstrumentBar.tsx`
- Create: `src/ui/SafeJarvisShell.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Create: `src/ui/safe-ui-contract.test.tsx`

**Interfaces:**
- Consumes: safe client/reducer, existing `PresenceField`, `StateLabel`, `LastExchange`, `Composer`, `FallbackStrip` and design tokens.
- Produces: the complete safe-mode UI, selected server-side by `page.tsx`.

- [ ] **Step 1: Write failing static UI contract tests**

```tsx
expect(source).toContain("<SafeAgentSelector");
expect(source).toContain("disabled={runIsActive}");
expect(source).toContain("<SafeApprovalCard");
expect(pageSource).toContain("isSafeAgentCoreEnabled()");
expect(pageSource).toContain("<JarvisShell />");
expect(pageSource).toContain("<SafeJarvisShell />");
```

The tests also assert the safe shell has no import from legacy shell/run executors, exposes a cancel action, and renders approval expiry, effect and preview/diff labels.

- [ ] **Step 2: Run the UI contract test and verify RED**

Run: `npx vitest run src/ui/safe-ui-contract.test.tsx`

Expected: FAIL because the safe UI files do not exist.

- [ ] **Step 3: Implement compact safe UI components**

```tsx
<SafeAgentSelector agents={agents} value={agentId} disabled={runIsActive} onChange={updateAgent} />
<SafeApprovalCard approval={pendingApproval} busy={decisionBusy} onDecision={decideApproval} />
<SafeInstrumentBar agentId={agentId} privacyClass={privacyClass} model={effectiveModel} status={runStatus} />
```

Use an inline native `<details>` disclosure for approval detail, existing focus-visible styles, and a subtle opacity/translate transition disabled by `prefers-reduced-motion`. Do not add a component library or full-screen morph.

- [ ] **Step 4: Implement `SafeJarvisShell` and server flag switch**

```tsx
export default function Home() {
  return isSafeAgentCoreEnabled() ? <SafeJarvisShell /> : <JarvisShell />;
}
```

On mount: reuse a valid session token, fetch agents and latest run snapshot, reduce stored events, then connect after the last event ID. On submit: create one run with the currently selected agent and freeze that selector until a terminal backend event. On reconnect: refetch the snapshot if the reducer reports a sequence gap. Approval and cancellation use protected APIs and wait for persisted events to update the sphere.

- [ ] **Step 5: Add safe-shell responsive styles**

Keep the existing orbital presence as the focal point, cap response measure at `65ch`, place the agent selector immediately above the composer field, and keep approval actions reachable at 320px viewport width. Add only token-based CSS and a reduced-motion override.

- [ ] **Step 6: Run UI tests, lint and typecheck**

Run: `npx vitest run src/ui/safe-ui-contract.test.tsx src/ui/safe-run-reducer.test.ts src/lib/safe-core-client.test.ts`

Run: `npm run lint`

Run: `npm run typecheck`

Expected: all PASS.

- [ ] **Step 7: Commit Task 7.6**

Commit: `git commit -m "feat: add safe-core operational shell"`

### Task 7.7: Task-wide verification, security review and report

**Files:**
- Create: `.superpowers/sdd/jarvis-evolution-core/task-7-report.md`
- Modify only if a verified finding requires it: Task 7 implementation/test files above.

**Interfaces:**
- Consumes: all Task 7 deliverables.
- Produces: independently reviewed Task 7 evidence and a clean branch ready for Task 8.

- [ ] **Step 1: Run focused Task 7 verification**

Run: `npx vitest run src/core/core-store.test.ts src/core/safe-orchestrator.test.ts src/core/safe-api-contract.test.ts src/core/safe-core-service.test.ts src/core/safe-core-runtime.test.ts src/core/safe-event-protocol.test.ts src/app/api/session/bootstrap/route.test.ts src/app/api/runs/route.test.ts src/app/api/safe-routes.test.ts src/app/api/runs/[runId]/events/route.test.ts src/lib/safe-core-client.test.ts src/ui/safe-run-reducer.test.ts src/ui/safe-ui-contract.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run the complete local verification suite**

Run: `npm test`

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npx next build --webpack`

Expected: all PASS. Record the known Turbopack sandbox failure separately if it remains reproducible.

- [ ] **Step 3: Perform a security-focused diff review**

Inspect the complete Task 7 diff for cross-session access, CSRF on fetch-SSE, raw prompt/tool input exposure, local-path leakage, approval decision ordering, continuation replay, unhandled async work, SSE resource leaks and any safe/legacy dual execution.

- [ ] **Step 4: Fix confirmed findings test-first and rerun affected suites**

For each confirmed finding, add a regression that fails for the original behavior, apply the smallest correction, then rerun the focused and full commands from Steps 1–2.

- [ ] **Step 5: Write the Task 7 report and commit any final review fix**

Record commit SHAs, test counts, build result, security invariants and the explicit process-restart limitation for exact pending continuations. If the review changes code, commit it as `fix: harden safe-core API flow`.

## Self-Review

- Spec coverage: session update, agent/workspace APIs, run create/get/cancel, approval decision, persisted envelope, SSE IDs, 15-second heartbeat, replay, protocol errors, Hermes default, immutable agent, effective provider/model, backend-derived state, exact sanitized approval card and SQLite reload reconstruction are each assigned above.
- Placeholder scan: every implementation step names exact files, interfaces, assertions and commands; no unresolved implementation marker remains.
- Type consistency: `SafeEventEnvelope`, `SafeRunSnapshot`, `SafeApprovalView`, `SafeCoreService`, `SafeCoreRuntime` and pending-continuation method names are defined before their consumers.
- Execution choice: the user already selected inline continuation of the existing implementation plan, so execute this plan with `superpowers:executing-plans` and checkpoint after each independently committed subtask.
