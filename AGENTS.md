<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify` or `$graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<from>" "<to>"` for relationships and `graphify explain "<symbol>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- **After every improvement or alteration** to code, config, docs, SQL schemas, or infrastructure, update the graph before finishing: `graphify update .` when graphify-out/graph.json exists, otherwise `graphify .`. Never hand off with a stale graph.

## Imported Cursor rules

Source and classification are recorded in `docs/rules/cursor-import.md`.

- Keep imports at the top of each module; document the rare circular-dependency exception.
- Project exception: documented runtime imports are allowed for optional platform-native SDKs, heavyweight browser capabilities, and lazy WebGL chunks.
- Use a `never` check in default branches of switches over TypeScript unions or enums.
- Use Mobbin MCP for UI/UX reference requests only when that MCP is actually available.
