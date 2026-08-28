# Hermes bridge surfaces — design

Date: 2026-08-25
Status: approved (plan mode)

## Goal

Expose remaining Hermes capabilities in Jarvis as thin HUD/API surfaces. Hermes stays the agent runtime. Jarvis stays presence, consent, and the Safe Core ledger.

## Decisions

- Do not clone Telegram/Discord/WhatsApp into Next. Proxy Hermes `GET/PATCH /api/messaging/platforms`.
- Do not port HuggingFace weights, EasyTool, or TaskBench. Multimodal DAG uses the existing skill plus `tool.started` / `tool.completed`.
- Do not write jobs to `scheduler.json`. Cron is Hermes `cron.manage`.
- Tokens never land in Jarvis SQLite, SSE, or logs.
- New UI lives in dedicated files. Do not grow `SafeJarvisShell.tsx` or `SafeLearningPanel.tsx` past 1000 lines.

## Surfaces

1. Persist `role: assistant` on `run.completed`.
2. `session.resume` from the Ambiente session menu.
3. `file.attach` / `image.attach` / `image.attach_bytes` before `prompt.submit`.
4. Cron list/add/pause in Ambiente.
5. Computer-use install button (POST already exists).
6. Subagent rail + `clarify.respond`.
7. Task graph panel from skill JSON + tool events.
8. Channel status/connect HUD.

## Files

- `src/integrations/hermes/bridge.ts` — persist, resume, attach, subagent/clarify RPCs
- `src/integrations/hermes/cron.ts`, `channels.ts`
- `src/app/api/hermes/cron/route.ts`, `channels/route.ts`
- `src/ui/AmbienteCron.tsx`, `AmbienteChannels.tsx`, `SubagentRail.tsx`, `TaskGraphPanel.tsx`
