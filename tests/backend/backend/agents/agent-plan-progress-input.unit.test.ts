import { expect, it } from "vitest";

import { readPlanProgress } from "@/backend/agents/AgentPlanProgressInput";

import { agentErrorCode } from "./agent-error-code";

import type { RecordFields } from "./agent-plan-record-fixture";

const WORK = {
  runId: "run",
  stepId: "step",
  attemptId: "attempt",
  ticketId: "t",
  ticketKey: "K-1",
  statusKey: "open",
  requirementsHash: "r",
  contentHash: "c",
  requiredChecks: ["lint"],
  items: [],
  record: null,
  issues: [],
};

function progress(changes: RecordFields = {}): RecordFields {
  return {
    source: "historical",
    observedAt: "now",
    todos: [{ id: "1", text: "Do", status: "done" }],
    ...changes,
  };
}

it("reads a progress projection without optional parts", () => {
  expect(readPlanProgress(progress())).toEqual({
    source: "historical",
    observedAt: "now",
    todos: [{ id: "1", text: "Do", status: "done" }],
  });
});

it("reads every optional part of a progress projection", () => {
  expect(
    readPlanProgress(
      progress({
        source: "live",
        todos: [
          {
            id: "1",
            text: "A",
            status: "active",
            ticket: { id: "t", key: "K-1", itemId: "i" },
          },
          { id: "2", text: "B", status: "open" },
          { id: "3", text: "C", status: "missing" },
          { id: "4", text: "D", status: "unreported" },
        ],
        work: [WORK],
        availability: "observed",
        tickets: [{ id: "t", key: "K-1", contentHash: "c" }],
        scope: { runId: "run", stepId: "step", attemptId: null },
      }),
    ),
  ).toMatchObject({
    source: "live",
    todos: [
      { status: "active", ticket: { id: "t", key: "K-1", itemId: "i" } },
      { status: "open" },
      { status: "missing" },
      { status: "unreported" },
    ],
    work: [{ ticketKey: "K-1" }],
    availability: "observed",
    tickets: [{ id: "t", key: "K-1", contentHash: "c" }],
    scope: { runId: "run", stepId: "step", attemptId: null },
  });
  expect(
    readPlanProgress(
      progress({
        availability: "unavailable",
        scope: { runId: "run", stepId: "step", attemptId: "attempt" },
      }),
    ),
  ).toMatchObject({
    availability: "unavailable",
    scope: { attemptId: "attempt" },
  });
});

it.each<[string, RecordFields]>([
  ["work that is no list", { work: {} }],
  ["an unknown source", { source: "cached" }],
  ["todos that are no list", { todos: null }],
  [
    "an unknown todo status",
    { todos: [{ id: "1", text: "A", status: "late" }] },
  ],
  [
    "a todo text that is no text",
    { todos: [{ id: "1", text: 1, status: "done" }] },
  ],
  ["an unknown availability", { availability: "partial" }],
  ["tickets that are no list", { tickets: {} }],
])("refuses a progress projection with %s", (scenario, change) => {
  expect(agentErrorCode(() => readPlanProgress(progress(change)))).toBe(
    "plan_invalid",
  );
});
