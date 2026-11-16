import { expect, it } from "vitest";

import { readAgentTodoList } from "@/backend/agents/AgentPlanAgentTodoInput";
import { readPlanProgress } from "@/backend/agents/AgentPlanProgressInput";
import { readEntries } from "@/backend/database/repositories/agent/AgentPlanAgentTodoRepository";
import { withPlanProgress } from "@/backend/service/agents/AgentPlanProgressView";
import { readTodoState } from "@/backend/service/agents/AgentPlanTodoState";
import { mergeAgentTodos } from "@/definition/AgentPlanAgentTodos";
import { AGENT_STEP_PROGRESS_STATUSES } from "@/definition/AgentPlanStepProgress";

import {
  progressRun,
  progressSession,
  progressStep,
  progressTicket,
} from "./page162-progress-fixture";
import { TODO_IDENTITY, todoFixture } from "./page358-todo-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanStepLiveProgress } from "@/definition/AgentPlanStepProgress";

const SCOPE = {
  runId: "run",
  stepId: "agent",
  attemptId: "attempt",
  iteration: "loop/1",
};
const TASKS = [
  { content: "Completed work", status: "completed" },
  { content: "Task with an explicit error", status: "failed" },
  { content: "Current work", status: "in_progress" },
  { content: "The overall run failed", status: "pending" },
  { content: "Unknown work", status: "unknown" },
];

it("maps only an explicit per-task failure to failed, leaving unknown and error prose neutral", () => {
  expect(mergeAgentTodos(TASKS, [], "now").map((todo) => todo.status)).toEqual([
    "done",
    "failed",
    "active",
    "open",
    "open",
  ]);
});

it("retains completed work and explicit error evidence when later updates omit a known state", () => {
  const previous = mergeAgentTodos(TASKS, [], "earlier");
  const next = mergeAgentTodos(
    [
      { content: "Completed work", status: "failed" },
      { content: "Task with an explicit error", status: "unknown" },
      { content: "Current work", status: "completed" },
      { content: "Replacement task", status: "pending" },
    ],
    previous,
    "later",
  );
  expect(next.map((todo) => todo.status)).toEqual([
    "done",
    "failed",
    "done",
    "open",
  ]);
  expect(next.map((todo) => todo.updatedAt)).toEqual([
    "earlier",
    "earlier",
    "later",
    "later",
  ]);
  const changed = mergeAgentTodos(
    [{ content: "Different task", status: "pending" }],
    previous,
    "later",
  );
  expect(changed[0]?.status).toBe("open");
});

it("allows a failed task to report recovery explicitly without modifying a previously completed task", () => {
  const previous = mergeAgentTodos(TASKS, [], "earlier");
  const next = mergeAgentTodos(
    TASKS.map((task) =>
      task.status === "failed" ? { ...task, status: "in_progress" } : task,
    ),
    previous,
    "later",
  );
  expect(next[0]?.status).toBe("done");
  expect(next[1]?.status).toBe("active");
});

it("round trips failed through internal run readers and stored agent/progress JSON", () => {
  const todos = mergeAgentTodos(TASKS, [], "now");
  expect(
    readAgentTodoList({ attemptId: "attempt", updatedAt: "now", todos }).todos,
  ).toEqual(todos);
  expect(readEntries(JSON.stringify(todos))).toEqual(todos);
  expect(
    readPlanProgress({ source: "live", observedAt: "now", todos }).todos.map(
      (todo) => todo.status,
    ),
  ).toEqual(todos.map((todo) => todo.status));
  const stored = {
    runId: "run",
    stepId: "agent",
    attemptId: "attempt",
    activity: null,
    updatedAt: "now",
    todosJson: JSON.stringify([
      { id: "T1", status: "failed" },
      { id: "T2", status: "done" },
    ]),
  };
  expect(readTodoState(stored).todos).toEqual([
    { id: "T1", status: "failed" },
    { id: "T2", status: "done" },
  ]);
});

function stateStep(
  status: AgentPlanStepResult["status"] = "running",
  tickets: readonly { readonly id: string; readonly key: string }[] = [],
): AgentPlanStepResult {
  const session = progressSession([]);
  return progressStep({
    status,
    session: {
      ...session,
      contract: {
        tickets,
        criteria: [],
        todos: [
          { id: "T1", text: "Failure", ticket: null },
          { id: "T2", text: "Done", ticket: null, checked: true },
          { id: "T3", text: "Unreported", ticket: null },
        ],
      },
      acceptance: {
        verdict: "open",
        criteria: [],
        issues: [],
        decisions: [],
        summary: "",
        todos: [
          { id: "T1", status: "open" },
          { id: "T2", status: "done" },
        ],
      },
    },
  });
}

const LIVE: AgentPlanStepLiveProgress = {
  attemptId: "attempt",
  activity: null,
  updatedAt: "now",
  todos: [
    { id: "T1", status: "failed" },
    { id: "T2", status: "failed" },
  ],
};

it.each(["running", "failed", "cancelled"] as const)(
  "projects only the identified task error for a %s step, keeping completed and unreported states",
  async (status) => {
    const projected = await withPlanProgress(progressRun([stateStep(status)]), {
      projectId: "project",
      tasks: { checklist: async () => progressTicket() },
      live: new Map([["agent", LIVE]]),
    });
    expect(
      projected.steps[0]?.progress?.todos.map((todo) => todo.status),
    ).toEqual(["failed", "done", "open"]);
  },
);

it("retains proven failures and completion when a checklist read becomes unavailable", async () => {
  const step = stateStep("running", [{ id: "ticket", key: "PAGE-410" }]);
  const projected = await withPlanProgress(progressRun([step]), {
    projectId: "project",
    tasks: {
      checklist: async () => {
        throw new Error("Checklist unavailable");
      },
    },
    live: new Map([["agent", LIVE]]),
  });
  expect(projected.steps[0]?.progress?.availability).toBe("unavailable");
  expect(
    projected.steps[0]?.progress?.todos.map((todo) => todo.status),
  ).toEqual(["failed", "done", "missing"]);
});

it("preserves stored errors over unrelated updates and same-iteration resumes without widening runner inputs", async () => {
  const fixture = todoFixture(
    "- [ ] Failed work\n- [ ] Completed work\n- [ ] Other work",
  );
  const contract = await fixture.progress.initialize(SCOPE, fixture.contract);
  fixture.rows.set("run/agent", {
    ...SCOPE,
    activity: null,
    updatedAt: "earlier",
    todosJson: JSON.stringify({
      scope: SCOPE.iteration,
      contract,
      todos: [
        { id: "T1", status: "failed" },
        { id: "T2", status: "done" },
        { id: "T3", status: "open" },
      ],
    }),
  });
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T3", status: "active" }],
  });
  expect(fixture.state().todos.map((todo) => todo.status)).toEqual([
    "failed",
    "done",
    "active",
  ]);
  await fixture.progress.initialize(
    { ...SCOPE, attemptId: "resumed" },
    fixture.contract,
  );
  expect(fixture.state().todos.map((todo) => todo.status)).toEqual([
    "failed",
    "done",
    "active",
  ]);
  expect(AGENT_STEP_PROGRESS_STATUSES).toEqual(["open", "active", "done"]);
  await expect(
    fixture.progress.update(TODO_IDENTITY, {
      todos: [{ id: "T1", status: "failed" }],
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await fixture.progress.initialize(
    { ...SCOPE, iteration: "loop/2" },
    fixture.contract,
  );
  expect(fixture.state().todos.every((todo) => todo.status === "open")).toBe(
    true,
  );
});
