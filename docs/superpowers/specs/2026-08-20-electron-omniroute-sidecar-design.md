# Electron sidecar design — Jarvis + OmniRoute

Date: 2026-08-20
Status: implemented

## Goal

One Electron shell for Jarvis. OmniRoute starts at the same time as a headless sidecar. Usage reports show inside Jarvis. OmniRoute no longer boots with `npm run dev` (8 GB heap + HMR).

## Decisions

- Do not launch `OmniRoute/electron`.
- Spawn system Node, never `ELECTRON_RUN_AS_NODE` (`better-sqlite3` ABI).
- OmniRoute command: `serve --no-open --no-tray` when a production bundle exists, else `npm start`, else `npm run dev` only with `JARVIS_OMNI_DEV=1`.
- Usage via loopback `GET /api/usage/quota` and `GET /api/usage/analytics?range=7d`.
- Dashboard OmniRoute opens only from the tray/menu.

## Files

- `scripts/sidecars.sh` — start/stop/status
- `desktop/main.cjs`, `desktop/preload.cjs`
- `src/app/api/omniroute/usage/route.ts`
- `src/ui/OmnirouteUsagePanel.tsx`
- `omniroute.usage_report` tool
