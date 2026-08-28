import { describe, expect, it } from "vitest";
import { parseTaskGraph } from "./task-graph";

describe("parseTaskGraph", () => {
  it("reads the first JSON task array from assistant text", () => {
    const text = `plano:\n{\n  "task": [\n    {"task": "image-generation", "id": 0, "dep": [-1]},\n    {"task": "visual-question-answering", "id": 1, "dep": [0]}\n  ]\n}\nfeito.`;
    expect(parseTaskGraph(text)).toEqual([
      { task: "image-generation", id: 0, dep: [-1] },
      { task: "visual-question-answering", id: 1, dep: [0] },
    ]);
  });

  it("returns null when there is no task graph", () => {
    expect(parseTaskGraph("olá")).toBeNull();
  });
});
