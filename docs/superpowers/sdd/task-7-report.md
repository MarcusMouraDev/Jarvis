# Task 7 report — Safe-core API, SSE and UI

Date: 2026-08-09  
Branch: `feat/safe-core-ui`

## Commits in scope

| SHA | Message |
|-----|---------|
| `1817d77` | docs: record safe-core UI completion design |
| `600cc7c` | feat: add safe-core event client |
| `b698bf1` | feat: add safe-core operational shell |

Base: `main` @ `a65a535` (Tasks 1–7.4 already present).

## Verification

| Command | Result |
|---------|--------|
| Focused Task 7 Vitest (13 files) | PASS — 72 tests |
| `npm test` | PASS — 279 tests / 46 files (sandbox `git init` hooks fail without full perms; environmental) |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npx next build --webpack` | PASS |

## Security review (Task 7 UI/client)

- Cross-session: client only talks to protected routes; server already binds runs/approvals to session cookie.
- CSRF on SSE: `streamRunEvents` → `safeCoreFetch` always sends `X-Jarvis-CSRF`; opaque session stays HttpOnly.
- Prompt/path leak: reducer/UI consume sanitized envelopes/`SafeApprovalView` only; no exact continuation in browser storage.
- Approval order: UI waits for persisted events after decision; sphere state only from reducer/events.
- Reload: snapshot + reduce + reconnect after last event ID; sequence gap triggers snapshot refetch.
- Dual path: `page.tsx` selects exactly one shell via `JARVIS_SAFE_AGENT_CORE===1`.
- Stream abort: abort controller cancels in-flight SSE on unmount/cancel/new connect.

## Explicit limitation

A pending approval may survive browser reload (SQLite approval row + in-process continuation while the Node process lives) but **does not** survive process restart, because the exact tool continuation is not persisted.

## Ready for Task 8

Client, reducer, safe shell, and verification gates for Task 7 are complete.
