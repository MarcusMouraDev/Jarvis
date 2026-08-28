# Cursor rule import

Source audit: `/Users/marcuspaulo/.cursor/plugins/cache` contained three `.mdc` rules on 2026-08-26. All source text is preserved under `.cursor/rules/` with an attribution comment.

| Rule | Source | Classification | Jarvis status |
| --- | --- | --- | --- |
| `no-inline-imports` | cursor-team-kit | developer-only | active |
| `typescript-exhaustive-switch` | cursor-team-kit | developer-only | active |
| `mobbin-usage` | mobbin | tool/workflow | active when Mobbin MCP is available |

These rules govern Cursor/developer behavior. They are not injected into Jarvis model prompts, tool arguments, audit events, or user content. The Mobbin rule is retained for provenance but does not claim an MCP connection exists.

Jarvis keeps four documented runtime-import exceptions for optional Cursor SDK, Playwright, and lazy WebGL loading; static imports would load platform-native or heavyweight code on every request.
