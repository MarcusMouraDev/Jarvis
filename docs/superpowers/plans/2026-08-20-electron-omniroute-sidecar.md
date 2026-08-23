# Jarvis Electron + OmniRoute sidecar — implementation plan

> Implemented 2026-08-20. Executors: follow this file plus the design spec.

**Goal:** Electron casco for Jarvis, parallel OmniRoute sidecar, in-app usage reports, no OmniRoute `npm run dev` by default.

**Architecture:** `desktop/main.cjs` runs `scripts/sidecars.sh start`, then loads `http://127.0.0.1:3000/`. Jarvis Next proxies OmniRoute usage on loopback.

**Tech stack:** Electron (devDependency), bash supervisor, Next.js route, existing OmnirouteMcpClient.

**Spec:** `docs/superpowers/specs/2026-08-20-electron-omniroute-sidecar-design.md`

## Tasks

- [x] `resolveOmniCommand` + `sidecars.sh` (parallel boot, serve/start, process-tree stop)
- [x] Electron main/preload, tray, single instance, GPU, system Node PATH
- [x] `/api/omniroute/usage` + usage panel + instrument chip
- [x] `omniroute.usage_report` + tests
