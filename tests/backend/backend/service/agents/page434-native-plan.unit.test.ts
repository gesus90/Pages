import { expect, it, vi } from "vitest";

import { AgentPlanAgentTodoRepository } from "@/backend/database/repositories/agent/AgentPlanAgentTodoRepository";
import { buildPlanContract } from "@/backend/service/agents/AgentPlanContract";
import { AgentPlanStepAssessment } from "@/backend/service/agents/AgentPlanStepAssessment";
import { AgentPlanStepReportService } from "@/backend/service/agents/AgentPlanStepReportService";

import { TODO_IDENTITY, todoFixture } from "./page358-todo-fixture";

import type { Database } from "@/backend/database/Database";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentPlanContract } from "@/definition/AgentPlanSession";
import type { AgentPlanStepReport } from "@/definition/AgentPlanStepReport";

const SCOPE = {
  runId: "run",
  stepId: "agent",
  attemptId: "attempt",
  iteration: "loop/1",
};

const REPORT: AgentPlanStepReport = {
  status: "done",
  message: "Finished",
  todos: [],
  criteria: [],
  decisions: [],
  summary: "Finished",
};

async function assess(
  fixture: ReturnType<typeof todoFixture>,
  provider: AgentProviderId = "codex_cli",
): Promise<Awaited<ReturnType<AgentPlanStepAssessment["assess"]>>> {
  return new AgentPlanStepAssessment(
    { checklist: async () => fixture.ticket() },
    fixture.progress,
  ).assess(
    {
      contract: fixture.contract,
      instruction: fixture.instruction,
      reach: "full",
    },
    "",
    { userId: "executor", projectId: "project", provider, progress: SCOPE },
    REPORT,
  );
}

function reportService(
  fixture: ReturnType<typeof todoFixture>,
  contract: AgentPlanContract,
): AgentPlanStepReportService {
  return new AgentPlanStepReportService(
    {
      open: async () => undefined,
      close: async () => null,
      find: async () => ({
        ...fixture.slot,
        termsJson: JSON.stringify({
          contract,
          instruction: fixture.instruction,
          reach: "full",
          projectId: "project",
          provider: "codex_cli",
        }),
      }),
      save: async () => true,
    },
    { checklist: async () => fixture.ticket() },
    fixture.progress,
  );
}

it("accepts Codex without native plan events through progress, checked ticket TODOs and an evidenced report", async () => {
  const fixture = todoFixture("", "- [ ] Implement");
  const contract = buildPlanContract("", [fixture.ticket()], {
    isReadOnly: false,
  });
  await fixture.progress.initialize(SCOPE, contract);
  const reports = reportService(fixture, contract);
  await expect(
    reports.report(TODO_IDENTITY, { ...REPORT, criteria: [] }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
    activity: "Implementation finished",
  });
  const report = {
    ...REPORT,
    criteria: [{ id: "K1", met: true, evidence: "Implementation verified" }],
  };
  await expect(reports.report(TODO_IDENTITY, report)).resolves.toMatchObject({
    status: "done",
  });
  const assessed = await new AgentPlanStepAssessment(
    { checklist: async () => fixture.ticket() },
    fixture.progress,
  ).assess(
    { contract, instruction: "", reach: "full" },
    "",
    {
      userId: "executor",
      projectId: "project",
      provider: "codex_cli",
      progress: SCOPE,
    },
    report,
  );
  expect(assessed.acceptance.verdict).toBe("accepted");
  expect(assessed.acceptance.issues).toEqual([]);
  expect(assessed.acceptance.todos).toEqual([{ id: "T1", status: "done" }]);
  expect(assessed.contract.todos.map((todo) => todo.id)).toEqual(["T1"]);
  expect(fixture.ticket().checklist.items[0]?.checked).toBe(true);
  expect((await fixture.progress.listForRun("run")).get("agent")).toMatchObject({
    activity: "Implementation finished",
    todos: [{ id: "T1", status: "done" }],
  });
});

it.each(["open", "active", "failed"] as const)(
  "keeps a native %s TODO blocking even if Pages progress declares the same task done",
  async (status) => {
    const fixture = todoFixture();
    await fixture.progress.initialize(SCOPE, fixture.contract);
    await fixture.progress.update(TODO_IDENTITY, {
      todos: [{ id: "T1", status: "done" }],
    });
    fixture.native.set("attempt", [
      { id: "1", text: "Local work", status, updatedAt: "now" },
    ]);
    const result = await assess(fixture);
    expect(result.acceptance.verdict).toBe("open");
    expect(result.acceptance.issues).toContain("todo_open:PAGES_PLAN");
  },
);

it("uses only the current attempt's native evidence and does not rewrite stored progress", async () => {
  const fixture = todoFixture();
  await fixture.progress.initialize(SCOPE, fixture.contract);
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
  });
  fixture.native.set("previous-attempt", []);
  const before = JSON.stringify([...fixture.rows]);
  const result = await assess(fixture);
  expect(result.acceptance.verdict).toBe("accepted");
  expect(result.acceptance.todos).toEqual([{ id: "T1", status: "done" }]);
  expect(JSON.stringify([...fixture.rows])).toBe(before);
});

it("applies a plan received after progress and retains its obligation when the same attempt resumes", async () => {
  const fixture = todoFixture();
  await fixture.progress.initialize(SCOPE, fixture.contract);
  await fixture.progress.update(TODO_IDENTITY, {
    todos: [{ id: "T1", status: "done" }],
  });
  expect((await assess(fixture)).acceptance.verdict).toBe("accepted");
  fixture.native.set("attempt", [
    { id: "1", text: "Local work", status: "open", updatedAt: "now" },
  ]);
  expect((await assess(fixture)).acceptance.issues).toContain(
    "todo_open:PAGES_PLAN",
  );
  await fixture.progress.initialize(SCOPE, fixture.contract);
  expect((await assess(fixture)).acceptance.issues).toContain(
    "todo_open:PAGES_PLAN",
  );
  fixture.native.set("attempt", [
    { id: "1", text: "Local work", status: "done", updatedAt: "later" },
  ]);
  expect((await assess(fixture)).acceptance.verdict).toBe("accepted");
});

it.each(["claude_code", "opencode", "antigravity"] as const)(
  "preserves acceptance for %s even after an empty plan event",
  async (provider) => {
    const fixture = todoFixture();
    await fixture.progress.initialize(SCOPE, fixture.contract);
    await fixture.progress.update(TODO_IDENTITY, {
      todos: [{ id: "T1", status: "done" }],
    });
    fixture.native.set("attempt", []);
    expect((await assess(fixture, provider)).acceptance.verdict).toBe("accepted");
  },
);

it("distinguishes no native event from an empty plan while preserving the existing entries API", async () => {
  const query = vi.fn<Database["query"]>().mockResolvedValue([]);
  const execute = vi.fn<Database["execute"]>();
  const repository = new AgentPlanAgentTodoRepository({ query, execute });
  expect(await repository.findPlan("attempt")).toBeNull();
  expect(await repository.findEntries("attempt")).toEqual([]);
  query.mockResolvedValue([["[]"]]);
  expect(await repository.findPlan("attempt")).toEqual([]);
  expect(await repository.findEntries("attempt")).toEqual([]);
  const entries = [
    { id: "1", text: "Native task", status: "done", updatedAt: "now" },
  ];
  query.mockResolvedValue([[JSON.stringify(entries)]]);
  expect(await repository.findPlan("attempt")).toEqual(entries);
  expect(query.mock.calls[0]?.[1]).toEqual({ attempt_id: "attempt" });
  expect(query.mock.calls[0]?.[0]).toContain("worker_id = ''");
  expect(execute).not.toHaveBeenCalled();
});
