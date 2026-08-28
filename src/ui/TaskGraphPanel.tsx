"use client";

import { parseTaskGraph } from "./task-graph";

export function TaskGraphPanel({
  assistantText,
  tools,
}: {
  assistantText: string;
  tools: ReadonlyArray<{ toolId: string; name: string; status: "started" | "completed" }>;
}) {
  const graph = parseTaskGraph(assistantText);
  if (!graph && tools.length === 0) return null;

  return (
    <div className="ambiente-block" aria-label="Grafo de tarefas">
      <p className="ambiente-kicker">grafo</p>
      <ol className="ambiente-sessions">
        {(graph ?? []).map((node) => (
          <li key={node.id}>
            <span>
              {node.id} {node.task}
              {node.dep[0] !== undefined && node.dep[0] >= 0 ? ` ← ${node.dep.join(",")}` : ""}
            </span>
          </li>
        ))}
        {tools.map((tool) => (
          <li key={tool.toolId}>
            <span>
              {tool.name} · {tool.status}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
