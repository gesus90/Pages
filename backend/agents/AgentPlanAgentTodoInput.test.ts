import { describe, expect, it } from "vitest";

import { readAgentTodoList } from "@/backend/agents/AgentPlanAgentTodoInput";
import { AgentError } from "@/backend/error/AgentErrors";

const LIST = {
  attemptId: "attempt",
  updatedAt: "2026-01-01T00:00:00Z",
  todos: [
    {
      id: "1",
      text: "Do it",
      status: "open",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
};

describe("readAgentTodoList", () => {
  it("reads a valid list, including an empty one", () => {
    expect(readAgentTodoList(LIST)).toEqual(LIST);
    expect(readAgentTodoList({ ...LIST, todos: [] }).todos).toEqual([]);
  });

  it("rejects anything but a strict list of TODOs", () => {
    const invalid = [
      null,
      "list",
      { ...LIST, attemptId: "" },
      { ...LIST, extra: true },
      { ...LIST, todos: [{ ...LIST.todos[0], status: "late" }] },
      { ...LIST, todos: [{ ...LIST.todos[0], id: "" }] },
      {
        ...LIST,
        todos: Array.from({ length: 41 }, () => LIST.todos[0]),
      },
    ];
    for (const input of invalid)
      expect(() => readAgentTodoList(input)).toThrow(AgentError);
    expect(() => readAgentTodoList(null)).toThrow(
      expect.objectContaining({ code: "plan_invalid" }),
    );
  });
});
