import { expect, it } from "vitest";

import { AgentPlanStepReportService } from "@/backend/service/agents/AgentPlanStepReportService";
import { AgentPlanStepAssessment } from "@/backend/service/agents/AgentPlanStepAssessment";

import { TODO_IDENTITY, todoFixture } from "./page358-todo-fixture";
import { progressTicket } from "./page162-progress-fixture";

const SCOPE = {
  runId: "run",
  stepId: "agent",
  attemptId: "attempt",
  iteration: "loop/1",
};

function stub<T>(value: unknown): T {
  return value as T;
}

function problemContaining(fragment: string): readonly string[] {
  return stub<readonly string[]>(
    expect.arrayContaining([stub<string>(expect.stringContaining(fragment))]),
  );
}

it("requires native TODOs after receiving even an empty native plan, independently of reported completion", async () => {
  const fixture = todoFixture();
  await fixture.progress.initialize(SCOPE, fixture.contract);
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
  });
  const reports = new AgentPlanStepReportService(
    {
      open: async () => undefined,
      close: async () => null,
      find: async () => fixture.slot,
      save: async () => true,
    },
    { checklist: async () => progressTicket() },
    fixture.progress,
  );
  fixture.native.set("attempt", []);
  await expect(
    reports.report(TODO_IDENTITY, { status: "done", message: "Finished" }),
  ).rejects.toMatchObject({
    details: {
      problems: problemContaining("native update_plan"),
    },
  });
  await expect(
    reports.report(TODO_IDENTITY, {
      status: "done",
      message: "Finished",
      todos: [{ id: "PAGES_PLAN", status: "done" }],
    }),
  ).rejects.toMatchObject({
    details: {
      problems: problemContaining("native update_plan"),
    },
  });
  fixture.native.set("attempt", [
    { id: "1", text: "Local work", status: "active", updatedAt: "now" },
  ]);
  await expect(
    reports.report(TODO_IDENTITY, { status: "done", message: "Finished" }),
  ).rejects.toMatchObject({
    details: {
      problems: problemContaining("Complete the open TODOs"),
    },
  });
  fixture.native.set("attempt", [
    { id: "1", text: "Local work", status: "done", updatedAt: "later" },
  ]);
  await expect(
    reports.report(TODO_IDENTITY, { status: "done", message: "Finished" }),
  ).resolves.toMatchObject({ status: "done" });
});

it("does not impose the native Codex plan requirement on Claude", async () => {
  const fixture = todoFixture();
  await fixture.progress.initialize(SCOPE, fixture.contract);
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
  });
  const assessed = await new AgentPlanStepAssessment(
    { checklist: async () => progressTicket() },
    fixture.progress,
  ).assess(
    {
      contract: fixture.contract,
      instruction: fixture.instruction,
      reach: "full",
    },
    "",
    {
      userId: "executor",
      projectId: "project",
      provider: "claude_code",
      progress: SCOPE,
    },
    {
      status: "done",
      message: "Finished",
      todos: [],
      criteria: [],
      decisions: [],
      summary: "Finished",
    },
  );
  expect(assessed.acceptance.verdict).toBe("accepted");
});
