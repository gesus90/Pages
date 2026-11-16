import { expect, it } from "vitest";

import {
  activeAgentTodo,
  mergeAgentTodos,
  readPlanEventEntries,
} from "@/definition/AgentPlanAgentTodos";

it("reads only structured entries and ignores malformed items", () => {
  expect(readPlanEventEntries("not JSON")).toBeNull();
  expect(readPlanEventEntries("null")).toBeNull();
  expect(readPlanEventEntries('{"entries":false}')).toBeNull();
  expect(
    readPlanEventEntries(
      JSON.stringify({
        entries: [
          { content: "One", status: "pending" },
          null,
          { content: 1, status: "failed" },
        ],
      }),
    ),
  ).toEqual([{ content: "One", status: "pending" }]);
});

it("keeps completed work and timestamps for unchanged entries", () => {
  const previous = mergeAgentTodos(
    [
      { content: " First ", status: "completed" },
      { content: "Second", status: "in_progress" },
    ],
    [],
    "earlier",
  );
  const next = mergeAgentTodos(
    [
      { content: "First", status: "pending" },
      { content: "Second", status: "unknown" },
    ],
    previous,
    "later",
  );
  expect(next).toEqual(previous);
  expect(activeAgentTodo(next)).toMatchObject({ id: "2", status: "active" });
  expect(activeAgentTodo([])).toBeNull();
});

it("bounds the list and its text", () => {
  const entries = Array.from({ length: 45 }, () => ({
    content: "x".repeat(250),
    status: "unknown",
  }));
  const result = mergeAgentTodos(entries, [], "now");
  expect(result).toHaveLength(40);
  expect(result[0]).toMatchObject({ text: "x".repeat(200), status: "open" });
});
