import { expect, it } from "vitest";

import { readPlanSessionRecord } from "@/backend/agents/AgentPlanSessionInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  buildPlanContract,
  renderPlanAssignment,
} from "@/backend/service/agents/AgentPlanContract";
import { AgentPlanStepAssessment } from "@/backend/service/agents/AgentPlanStepAssessment";
import { AgentPlanStepReportService } from "@/backend/service/agents/AgentPlanStepReportService";
import { withPlanProgress } from "@/backend/service/agents/AgentPlanProgressView";

import {
  progressRun,
  progressSession,
  progressStep,
  progressTicket,
} from "./page162-progress-fixture";
import { TODO_IDENTITY, todoFixture } from "./page358-todo-fixture";

const SCOPE = {
  runId: "run",
  stepId: "agent",
  attemptId: "attempt",
  iteration: "loop/1",
};

it("extracts all three stored ticket criteria as initial TODOs, plus genuine Markdown tasks only", () => {
  const criteria = [1, 2, 3].map((number) => ({
    id: String(number),
    workItemId: "ticket",
    title: `Criterion ${number}`,
    isDone: false,
    sortOrder: number,
    createdAt: "now",
    updatedAt: "now",
  }));
  const ticket = progressTicket("", "ticket", criteria);
  expect(
    buildPlanContract("", [ticket], { isReadOnly: false, completion: "todos" })
      .todos,
  ).toHaveLength(3);
  const contract = buildPlanContract(
    "- [ ] Instruction\n```md\n- [ ] Example\n```",
    [
      progressTicket(
        "- [ ] Description\n- [x] Already done",
        "ticket",
        criteria,
      ),
    ],
    { isReadOnly: false },
  );
  expect(contract.todos.map((todo) => todo.text)).toEqual([
    "Instruction",
    "Description",
    "Already done",
    "Criterion 1",
    "Criterion 2",
    "Criterion 3",
  ]);
  expect(contract.todos[2]?.checked).toBe(true);
});

it("persists the entire list before the first agent update and projects 0 / 3", async () => {
  const fixture = todoFixture("- [ ] One\n- [ ] Two\n- [ ] Three");
  const contract = await fixture.progress.initialize(SCOPE, fixture.contract);
  expect(fixture.state().todos.map((todo) => todo.status)).toEqual([
    "open",
    "open",
    "open",
  ]);
  const run = await withPlanProgress(
    progressRun([
      progressStep({ session: { ...progressSession([]), contract } }),
    ]),
    {
      projectId: "project",
      tasks: { checklist: async () => progressTicket() },
      live: await fixture.progress.listForRun("run"),
    },
  );
  expect(run.steps[0]?.progress?.todos).toHaveLength(3);
  expect(
    run.steps[0]?.progress?.todos.every((todo) => todo.status === "open"),
  ).toBe(true);
});

it("checks the bound ticket immediately through the plan progress tool with a fresh revision", async () => {
  const fixture = todoFixture("", "- [ ] Implement\n- [ ] Verify");
  await fixture.progress.initialize(SCOPE, fixture.contract);
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
  });
  expect(fixture.writes).toHaveBeenCalledWith(
    TODO_IDENTITY,
    expect.objectContaining({
      checked: true,
      expectedRevision: "7",
      itemId: fixture.contract.todos[0]?.ticket?.itemId,
    }),
  );
  expect(fixture.ticket().checklist.items.map((item) => item.checked)).toEqual([
    true,
    false,
  ]);
  expect(fixture.state().todos.map((todo) => todo.status)).toEqual([
    "done",
    "open",
  ]);
});

it("retains completion across pause, abort recovery and a fresh attempt, showing only open TODOs", async () => {
  const fixture = todoFixture("- [ ] Done work\n- [ ] Remaining work");
  await fixture.progress.initialize(SCOPE, fixture.contract);
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
  });
  const resumed = await fixture.progress.initialize(
    { ...SCOPE, runId: "recovery", sourceRunId: "run", attemptId: "new" },
    fixture.contract,
  );
  const prompt = renderPlanAssignment({
    contract: resumed,
    usesMcp: true,
    isReadOnly: false,
    runnerLabel: "Codex",
    instanceId: "new",
    directory: "/workspace",
  });
  expect(prompt).not.toContain("**T1**");
  expect(prompt).toContain("**T2**: Remaining work");
  expect(resumed.todos[0]?.checked).toBe(true);
});

it("isolates the next iteration even when its ticket has the same checkbox ID and text", async () => {
  const fixture = todoFixture("- [ ] Same work");
  await fixture.progress.initialize(SCOPE, fixture.contract);
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
  });
  const next = await fixture.progress.initialize(
    { ...SCOPE, iteration: "loop/2", attemptId: "next" },
    fixture.contract,
  );
  expect(next.todos[0]?.checked).toBe(false);
  expect(fixture.state().todos).toEqual([{ id: "T1", status: "open" }]);
});

it("imports agent-created structured plans and requires their open work at report time", async () => {
  const fixture = todoFixture("");
  await fixture.progress.initialize(SCOPE, fixture.contract);
  fixture.native.set("attempt", [
    { id: "1", text: "Agent-created work", status: "open", updatedAt: "now" },
  ]);
  const assessed = await new AgentPlanStepAssessment(
    { checklist: async () => progressTicket() },
    fixture.progress,
  ).assess(
    { contract: fixture.contract, reach: "full", instruction: "" },
    "",
    {
      userId: "executor",
      projectId: "project",
      provider: "codex_cli",
      progress: SCOPE,
    },
    {
      status: "done",
      message: "Done",
      todos: [],
      criteria: [],
      decisions: [],
      summary: "Done",
    },
  );
  const id = assessed.contract.todos[0]?.id;
  expect(id).toMatch(/^A/u);
  expect(assessed.contract.todos[0]?.text).toBe("Agent-created work");
  expect(assessed.acceptance.issues).toContain(`todo_missing:${id}`);
  if (!id) throw new Error("Missing agent todo ID");
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id, status: "done" }],
  });
  expect(
    (await fixture.progress.current(SCOPE, fixture.contract)).todos[0]?.checked,
  ).toBe(true);
});

it("accepts QA delegation as done, including its ticket checkbox, without running QA commands", async () => {
  const fixture = todoFixture("", "- [ ] pnpm run lint ausführen");
  await fixture.progress.initialize(SCOPE, fixture.contract);
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
    activity: "an die Abschluss-QA übergeben",
  });
  const reports = new AgentPlanStepReportService(
    {
      open: async () => undefined,
      close: async () => null,
      find: async () => fixture.slot,
      save: async () => true,
    },
    { checklist: async () => fixture.ticket() },
    fixture.progress,
  );
  await expect(
    reports.report(TODO_IDENTITY, {
      status: "done",
      message: "an die Abschluss-QA übergeben",
      todos: [{ id: "T1", status: "done" }],
    }),
  ).resolves.toMatchObject({ status: "done" });
  expect(fixture.ticket().checklist.items[0]?.checked).toBe(true);
});

it("returns open TODO texts with a refused completion report and accepts the corrected report in the same slot", async () => {
  const fixture = todoFixture();
  await fixture.progress.initialize(SCOPE, fixture.contract);
  const reports = new AgentPlanStepReportService(
    {
      open: async () => undefined,
      close: async () => null,
      find: async () => fixture.slot,
      save: async () => true,
    },
    { checklist: async () => fixture.ticket() },
    fixture.progress,
  );
  await expect(
    reports.report(TODO_IDENTITY, { status: "done", message: "Finished" }),
  ).rejects.toMatchObject({
    details: { problems: [expect.stringContaining("Local work")] },
  });
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
  });
  await expect(
    reports.report(TODO_IDENTITY, { status: "done", message: "Finished" }),
  ).resolves.toMatchObject({ status: "done" });
});

it("keeps each iteration's ticket projection separate from the original stack binding", async () => {
  const first = progressTicket("- [x] First ticket work", "first");
  const second = progressTicket("- [ ] Second ticket work", "second");
  const fixture = todoFixture();
  const firstContract = buildPlanContract("", [first], {
    isReadOnly: false,
    completion: "todos",
  });
  const secondContract = buildPlanContract("", [second], {
    isReadOnly: false,
    completion: "todos",
  });
  await fixture.progress.initialize(SCOPE, firstContract);
  const current = await fixture.progress.initialize(
    { ...SCOPE, iteration: "loop/2", attemptId: "second-attempt" },
    secondContract,
  );
  const run = await withPlanProgress(
    progressRun([
      progressStep({
        session: {
          ...progressSession([]),
          attemptId: "second-attempt",
          contract: current,
        },
      }),
    ]),
    {
      projectId: "project",
      stepTickets: { agent: ["first"] },
      live: await fixture.progress.listForRun("run"),
      tasks: {
        checklist: async (_user, _project, id) =>
          id === "first" ? first : second,
      },
    },
  );
  expect(run.steps[0]?.progress?.todos).toMatchObject([
    { text: "Second ticket work", status: "open", ticket: { id: "second" } },
  ]);
  expect(run.steps[0]?.progress?.todos).toHaveLength(1);
});

it("keeps an empty report-mode contract empty and accepts its closing report", async () => {
  const contract = buildPlanContract("Explain the result", [], {
    isReadOnly: false,
  });
  expect(contract.todos).toEqual([]);
  expect(contract.criteria).toEqual([]);
  const result = await new AgentPlanStepAssessment({
    checklist: async () => progressTicket(),
  }).assess(
    { contract, reach: "full", instruction: "Explain the result" },
    "",
    { userId: "executor", projectId: "project", provider: "codex_cli" },
    {
      status: "done",
      message: "Result explained",
      todos: [],
      criteria: [],
      decisions: [],
      summary: "Explained",
    },
  );
  expect(result.acceptance.verdict).toBe("accepted");
});

it("keeps agent TODO IDs and completed work when a native plan reorders entries or a session resumes", async () => {
  const fixture = todoFixture("");
  await fixture.progress.initialize(SCOPE, fixture.contract);
  fixture.native.set("attempt", [
    { id: "1", text: "First work", status: "done", updatedAt: "now" },
    { id: "2", text: "Second work", status: "open", updatedAt: "now" },
  ]);
  const first = await fixture.progress.current(SCOPE, fixture.contract);
  fixture.native.set("attempt", [
    { id: "1", text: "Second work", status: "open", updatedAt: "later" },
    { id: "2", text: "First work", status: "done", updatedAt: "later" },
  ]);
  const reordered = await fixture.progress.current(SCOPE, fixture.contract);
  expect(reordered.todos.find((todo) => todo.text === "First work")?.id).toBe(
    first.todos[0]?.id,
  );
  const resumed = await fixture.progress.initialize(
    { ...SCOPE, attemptId: "resumed" },
    fixture.contract,
  );
  expect(
    resumed.todos.find((todo) => todo.text === "First work")?.checked,
  ).toBe(true);
  expect(
    resumed.todos.find((todo) => todo.text === "Second work")?.checked,
  ).toBe(false);
});

it("ticks a separately stored acceptance criterion through the same progress tool", async () => {
  const fixture = todoFixture("", "", [
    {
      id: "criterion",
      workItemId: "ticket",
      title: "Observable behavior",
      isDone: false,
      sortOrder: 0,
      createdAt: "now",
      updatedAt: "now",
    },
  ]);
  await fixture.progress.initialize(SCOPE, fixture.contract);
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
  });
  expect(fixture.writes).toHaveBeenCalledWith(
    TODO_IDENTITY,
    expect.objectContaining({ itemId: "ac-criterion", checked: true }),
  );
  expect(fixture.ticket().checklist.items[0]?.checked).toBe(true);
});

it("rereads and retries a concurrent ticket revision without losing the completed state", async () => {
  const fixture = todoFixture("", "- [ ] Work");
  await fixture.progress.initialize(SCOPE, fixture.contract);
  fixture.writes.mockRejectedValueOnce(new AgentOperationError("CONFLICT"));
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
  });
  expect(fixture.writes).toHaveBeenCalledTimes(2);
  expect(fixture.state().todos[0]?.status).toBe("done");
});

it("leaves progress open when the ticket write is refused", async () => {
  const fixture = todoFixture("", "- [ ] Work");
  await fixture.progress.initialize(SCOPE, fixture.contract);
  fixture.writes.mockRejectedValueOnce(new AgentOperationError("FORBIDDEN"));
  await expect(
    fixture.progress.update(TODO_IDENTITY, {
      todos: [{ id: "T1", status: "done" }],
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(fixture.state().todos[0]?.status).toBe("open");
  expect(fixture.ticket().checklist.items[0]?.checked).toBe(false);
});

it("round-trips the persisted TODO-return budget and refuses an impossible counter", () => {
  expect(
    readPlanSessionRecord({ ...progressSession([]), todoReturns: 2 })
      ?.todoReturns,
  ).toBe(2);
  expect(() =>
    readPlanSessionRecord({ ...progressSession([]), todoReturns: 4 }),
  ).toThrow();
});
