export interface GraphTask {
  task: string;
  id: number;
  dep: number[];
}

function asTask(value: unknown): GraphTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.task !== "string" || typeof row.id !== "number") return null;
  const dep = Array.isArray(row.dep)
    ? row.dep.filter((item): item is number => typeof item === "number")
    : [-1];
  return { task: row.task, id: row.id, dep };
}

export function parseTaskGraph(text: string): GraphTask[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const tasks = (parsed as { task?: unknown }).task;
    if (!Array.isArray(tasks)) return null;
    const graph = tasks.map(asTask).filter((item): item is GraphTask => item !== null);
    return graph.length > 0 ? graph : null;
  } catch {
    return null;
  }
}
