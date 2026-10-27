import { beforeEach, expect, it, vi } from "vitest";

import {
  emptyAgentConfiguration,
  acpRunOptions,
} from "@/definition/AgentConfiguration";

import { AgentPlanWorkGate } from "@/backend/service/agents/AgentPlanWorkGate";
import { materializeTicketChecklist } from "@/backend/service/task/TicketChecklist";
import { sessionOperations } from "@/backend/service/mcp/AgentOperationCatalog";
import { readPlanNode } from "@/backend/agents/AgentPlanInput";
import { planStepExecutionSchema } from "@/definition/AgentPlanExecution";
import {
  buildPlanContract,
  renderPlanAssignment,
} from "@/backend/service/agents/AgentPlanContract";

import { parameterRunFixture } from "./page55-run-fixture";
import { TICKET, TICKET_ACTOR } from "./page55-ticket-fixture";
import { remoteTodoStep } from "./page162-remote-fixture";
import {
  progressRun,
  progressSession,
  progressStep,
} from "./page162-progress-fixture";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type {
  AgentPlanWorkRecord,
  AgentPlanWorkView,
} from "@/definition/AgentPlanWork";

const memory = vi.hoisted(() => ({
  basis: vi.fn(),
  find: vi.fn(),
  insert: vi.fn(),
  ticket: vi.fn(),
  permissions: vi.fn(),
  project: vi.fn(),
}));

vi.mock(
  "@/backend/database/repositories/agent/AgentPlanWorkRepository",
  () => ({
    AgentPlanWorkRepository: class {
      public basis = memory.basis;
      public find = memory.find;
      public insert = memory.insert;
    },
  }),
);
vi.mock("@/backend/service/agents/AgentTaskAccess", () => ({
  createAgentTaskContext: () => ({
    tasks: {
      getById: memory.ticket,
      getByKey: memory.ticket,
      findChecklistItems: async () => [],
      actionPermissions: memory.permissions,
      findAllStatuses: async () => [
        { id: "review", key: "review", name: "Review", isDone: false },
        { id: "done", key: "done", name: "Done", isDone: true },
      ],
    },
    projects: { canWriteProject: memory.project },
  }),
}));

const transaction: DatabaseTransaction = { execute: vi.fn(), query: vi.fn() };
const database = {
  transaction: async <Result>(
    work: (scope: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work(transaction),
};
const gate = new AgentPlanWorkGate(database, {
  getById: async () => TICKET_ACTOR,
});
const step = {
  ...remoteTodoStep(),
  completionGate: { version: 1 as const, requiredChecks: ["focused"] },
};
const run = {
  ...progressRun([progressStep({ session: progressSession([]) })]),
  userId: "owner",
};
const snapshot = {
  plan: { projectId: "project", nodes: [step] },
  steps: [{ step, taskIds: [TICKET.id] }],
};
const identity: AgentIdentity = {
  userId: "owner",
  isAdmin: false,
  permissions: [],
  run: {
    runId: run.id,
    stepId: step.id,
    reach: "full",
    operations: [],
    tickets: [{ id: TICKET.id, key: TICKET.key }],
  },
};
let ticket = {
  ...TICKET,
  description:
    "- [ ] Implement requested behavior\n- [ ] Independent foreign task",
  statusKey: "in_progress",
};
let record: AgentPlanWorkRecord | null = null;

beforeEach(() => {
  ticket = {
    ...TICKET,
    description:
      "- [ ] Implement requested behavior\n- [ ] Independent foreign task",
    statusKey: "in_progress",
  };
  record = null;
  memory.basis.mockResolvedValue({ run, snapshot });
  memory.find.mockImplementation(async () => record);
  memory.insert.mockImplementation(
    async (key: unknown, next: AgentPlanWorkRecord) => {
      expect(key).toMatchObject({ runId: run.id, stepId: step.id });
      record = next;
    },
  );
  memory.ticket.mockImplementation(async () => ticket);
  memory.permissions.mockResolvedValue({ canWrite: true });
  memory.project.mockResolvedValue(true);
});

async function read(): Promise<AgentPlanWorkView> {
  return gate.handle(identity, "ticket.work.read", { ticketId: ticket.id });
}

async function saveScope(): Promise<AgentPlanWorkView> {
  const view = await read();
  return gate.handle(identity, "ticket.work.save", {
    ...request(view),
    action: "scope",
    scope: view.items.map((item, index) => ({
      itemId: item.id,
      relevant: index === 0,
      reason: index ? "Separate assignment owned by another user" : "",
    })),
  });
}

function request(view: AgentPlanWorkView): Record<string, unknown> {
  return {
    ticketId: view.ticketId,
    expectedRevision: view.record?.revision ?? 0,
    requirementsHash: view.requirementsHash,
    contentHash: view.contentHash,
    action: "confirm",
    scope: view.record?.scope ?? [],
    note: "Verified requested implementation and focused regression",
    proofs: view.items
      .filter((item) =>
        view.record?.scope.some(
          (entry) => entry.relevant && entry.itemId === item.id,
        ),
      )
      .map((item) => ({
        itemId: item.id,
        evidence: "Implementation observed; focused regression passed",
      })),
    checks: [
      {
        name: "focused",
        command: "pnpm run test:backend own.unit.test.ts",
        exitCode: 0,
        evidence: "Regression passed, exit 0",
      },
    ],
  };
}

it("requires concrete stored scope, not exit 0 or a done assertion", async () => {
  const output = '{"status":"done","message":"claimed"}';
  const result = await gate.settle(
    run.id,
    step.id,
    { status: "succeeded", output, session: progressSession([]) },
    "owner",
  );
  expect(result).toMatchObject({
    status: "failed",
    error: "plan_work_gate_failed",
    output,
    session: { resultCode: -1, acceptance: { verdict: "open" } },
  });
});

it("keeps open relevant work blocking while explained foreign tasks do not need checking", async () => {
  await saveScope();
  const view = await read();
  expect(view.issues).toContain(`todo_open:${view.items[0]?.id}`);
  expect(view.issues).not.toContain(`todo_open:${view.items[1]?.id}`);
  await expect(
    gate.handle(identity, "ticket.work.save", request(view)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("rejects a completely checked list without required proof", async () => {
  await saveScope();
  ticket.description = ticket.description.replace("[ ]", "[x]");
  const view = await read();
  await expect(
    gate.handle(identity, "ticket.work.save", { ...request(view), checks: [] }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    gate.handle(identity, "ticket.work.save", { ...request(view), proofs: [] }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("accepts actual current work and checks only after confirmed Review, preserving final JSON", async () => {
  await saveScope();
  ticket.description = ticket.description.replace("[ ]", "[x]");
  await gate.handle(identity, "ticket.work.save", request(await read()));
  await expect(gate.verify(run.id, step.id, "owner")).rejects.toMatchObject({
    code: "plan_work_gate_failed",
  });
  ticket.statusKey = "review";
  const output = '{"status":"done","message":"proved work"}';
  expect(
    await gate.settle(
      run.id,
      step.id,
      { status: "succeeded", output, session: progressSession([]) },
      "owner",
    ),
  ).toMatchObject({
    status: "succeeded",
    output,
    session: {
      acceptance: { verdict: "accepted" },
      contract: { completionGate: { version: 1, requiredChecks: ["focused"] } },
    },
  });
});

it("detects additions, requirement edits and reopening after confirmation", async () => {
  await saveScope();
  ticket.description = ticket.description.replace("[ ]", "[x]");
  await gate.handle(identity, "ticket.work.save", request(await read()));
  ticket.description += "\n- [ ] Newly required behavior";
  const expanded = await read();
  expect(expanded.issues).toContain("work_scope_changed");
  expect(
    expanded.issues.some((issue) => issue.startsWith("work_unassigned:")),
  ).toBe(true);
  ticket.description = ticket.description.replace("[x]", "[ ]");
  expect(
    (await read()).issues.some((issue) => issue.startsWith("todo_open:")),
  ).toBe(true);
});

it("compares metadata and ticket versions before writing without losing another editor's scope", async () => {
  const stale = await read();
  await saveScope();
  await expect(
    gate.handle(identity, "ticket.work.save", {
      ...request(stale),
      action: "scope",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const current = await read();
  ticket.description += "\nConcurrent description change";
  await expect(
    gate.handle(identity, "ticket.work.save", request(current)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(record?.revision).toBe(1);
});

it("requires an explicit explanation for every exclusion and forbids empty work", async () => {
  const view = await read();
  const scope = view.items.map((item) => ({
    itemId: item.id,
    relevant: false,
    reason: "",
  }));
  await expect(
    gate.handle(identity, "ticket.work.save", {
      ...request(view),
      action: "scope",
      scope,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("does not reuse a previous attempt's confirmation on retry", async () => {
  await saveScope();
  memory.basis.mockResolvedValue({
    run: {
      ...run,
      steps: [
        progressStep({
          session: { ...progressSession([]), attemptId: "new-attempt" },
        }),
      ],
    },
    snapshot,
  });
  memory.find.mockResolvedValue(null);
  expect((await read()).attemptId).toBe("new-attempt");
  expect((await read()).issues).toContain("work_scope_missing");
});

it("refuses read-only and currently revoked write access without gaining control rights", async () => {
  if (!identity.run) throw new Error("Missing run fixture");
  const view = await read();
  await expect(
    gate.handle(
      { ...identity, run: { ...identity.run, reach: "read" } },
      "ticket.work.save",
      request(view),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  memory.permissions.mockResolvedValue({ canWrite: false });
  await expect(
    gate.handle(identity, "ticket.work.save", request(view)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    sessionOperations({ ...identity.run, reach: "read" }, false),
  ).not.toContain("ticket.work.save");
  expect(sessionOperations(identity.run, false)).not.toContain("plans.play");
});

it("blocks Review before the latest mandatory confirmation", async () => {
  await expect(
    gate.guardStatus(identity, { ticketId: ticket.id, statusId: "review" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    gate.guardStatus(identity, { ticketId: ticket.id, statusId: "todo" }),
  ).resolves.toBeUndefined();
});

it("preserves opt-in settings in stored nodes and explains separate evidence in the runner contract", () => {
  expect(readPlanNode(step)).toMatchObject({
    completion: "todos",
    completionGate: { version: 1, requiredChecks: ["focused"] },
  });
  const contract = buildPlanContract(
    "Implement the bound ticket",
    [
      {
        id: ticket.id,
        key: ticket.key,
        title: ticket.title,
        checklist: materializeTicketChecklist(ticket.description, []),
      },
    ],
    {
      isReadOnly: false,
      completion: "todos",
      completionGate: step.completionGate,
    },
  );
  const prompt = renderPlanAssignment({
    contract,
    isReadOnly: false,
    usesMcp: true,
    runnerLabel: "codex",
    instanceId: "instance",
    directory: "/synthetic",
  });
  expect(prompt).toContain("save_ticket_work");
  expect(prompt).toContain("focused");
  expect(prompt).not.toContain("Regular runner completion releases");
});

it("refuses an opt-in inside loop execution rather than silently bypassing its server gate", () => {
  expect(() =>
    readPlanNode({
      id: "loop",
      type: "loop",
      name: "Synthetic loop",
      x: 0,
      y: 0,
      countMode: "max",
      sessionPolicy: "fresh",
      runsSource: "value",
      runs: 1,
      steps: [step],
      edges: [],
      bindings: {},
    }),
  ).toThrow(expect.objectContaining({ code: "plan_work_gate_unavailable" }));
});

it("refuses an opt-in in a shared group credential lifecycle instead of claiming a per-node gate", () => {
  expect(() =>
    readPlanNode({
      id: "group",
      type: "group",
      name: "Synthetic group",
      x: 0,
      y: 0,
      steps: [step],
      parameters: [],
      bindings: {},
    }),
  ).toThrow(expect.objectContaining({ code: "plan_work_gate_unavailable" }));
});

it("does not invalidate own proof when an explicitly excluded foreign box changes", async () => {
  await saveScope();
  ticket.description = ticket.description.replace("[ ]", "[x]");
  await gate.handle(identity, "ticket.work.save", request(await read()));
  ticket.description = ticket.description.replace("[ ]", "[x]");
  ticket.statusKey = "review";
  await expect(gate.verify(run.id, step.id, "owner")).resolves.toHaveLength(1);
});

it("checks actual project write permission before starting and rejects a missing binding", async () => {
  const fixture = await parameterRunFixture(
    { ...emptyAgentConfiguration(), run: acpRunOptions("yolo", 0) },
    "codex_cli",
  );
  const selected = {
    ...fixture.step,
    step: {
      ...fixture.step.step,
      completion: "todos" as const,
      completionGate: step.completionGate,
    },
    taskIds: [ticket.id],
  };
  const current = {
    ...fixture.snapshot,
    steps: [selected],
    plan: { ...fixture.snapshot.plan, nodes: [selected.step] },
  };
  memory.project.mockResolvedValue(false);
  await expect(
    gate.preflight("owner", current, selected.step.id),
  ).rejects.toMatchObject({ code: "plan_work_gate_write_required" });
  memory.project.mockResolvedValue(true);
  await expect(
    gate.preflight("owner", { ...current, steps: [] }, selected.step.id),
  ).rejects.toMatchObject({ code: "plan_work_gate_unavailable" });
});

it("retains verified predecessor evidence on resume but never adopts it for a different attempt", async () => {
  await saveScope();
  ticket.description = ticket.description.replace("[ ]", "[x]");
  await gate.handle(identity, "ticket.work.save", request(await read()));
  ticket.statusKey = "review";
  const completed = {
    ...run,
    steps: run.steps.map((entry) => ({
      ...entry,
      status: "succeeded" as const,
    })),
  };
  const resumed = {
    ...completed,
    id: "resumed-run",
    status: "running" as const,
    origin: {
      kind: "resume" as const,
      runId: run.id,
      mode: "new_session" as const,
      checkpointVersion: 1,
      reusedStepIds: [step.id],
      retriedStepIds: [],
      reviewedStepIds: [],
      requestedAt: new Date().toISOString(),
    },
  };
  const execution = planStepExecutionSchema.parse({
    schemaVersion: 1,
    planId: resumed.planId,
    runId: resumed.id,
    stepId: step.id,
    attemptId: "00000000-0000-4000-8000-000000000099",
    planRevision: resumed.planRevision,
    target: { kind: "local" },
    workspace: { id: "workspace", path: "/synthetic", revision: 1 },
    modelAccess: {
      connectionId: null,
      connectionName: "Fixture",
      provider: "codex_cli",
      model: "synthetic",
      reasoningEffort: null,
    },
  });
  const withDispatch = {
    ...resumed,
    steps: resumed.steps.map((entry) => ({ ...entry, execution })),
  };
  memory.basis.mockImplementation(async (runId: string) => ({
    run: runId === resumed.id ? withDispatch : completed,
    snapshot,
  }));
  memory.find.mockImplementation(async (key: { readonly runId: string }) =>
    key.runId === run.id ? record : null,
  );
  await expect(gate.verify(resumed.id, step.id, "owner")).resolves.toHaveLength(
    1,
  );
  memory.basis.mockResolvedValue({
    run: {
      ...resumed,
      steps: [
        progressStep({
          session: { ...progressSession([]), attemptId: "retried" },
        }),
      ],
    },
    snapshot,
  });
  await expect(gate.verify(resumed.id, step.id, "owner")).rejects.toMatchObject(
    { code: "plan_work_gate_failed" },
  );
});

it("shows unavailable progress after a failed read without hiding the run or claiming an empty accepted list", async () => {
  const observedRun = {
    ...run,
    steps: [
      progressStep({
        session: progressSession([]),
        progress: {
          source: "live" as const,
          observedAt: new Date().toISOString(),
          availability: "observed" as const,
          todos: [],
        },
      }),
    ],
  };
  memory.basis.mockResolvedValue({ run: observedRun, snapshot });
  memory.ticket.mockRejectedValue(new Error("Ticket permission changed"));
  const result = await gate.withProgress(observedRun);
  expect(result.id).toBe(run.id);
  expect(result.steps[0]?.progress).toMatchObject({
    availability: "unavailable",
    work: [],
  });
  await expect(gate.verify(run.id, step.id, "owner")).rejects.toThrow(
    "Ticket permission changed",
  );
});

it("requires classification of every added entry and detects removed scoped work", async () => {
  await saveScope();
  ticket.description = ticket.description.split("\n")[1] ?? "";
  expect(
    (await read()).issues.some((issue) => issue.startsWith("work_removed:")),
  ).toBe(true);
  const view = await read();
  await expect(
    gate.handle(identity, "ticket.work.save", {
      ...request(view),
      action: "scope",
      scope: [],
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("refuses metadata for another ticket, a stopped node or a non-running attempt", async () => {
  memory.ticket.mockResolvedValue({ ...ticket, id: "other-ticket" });
  await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
  memory.ticket.mockImplementation(async () => ticket);
  memory.basis.mockResolvedValue({
    run: { ...run, stopRequested: true },
    snapshot,
  });
  await expect(read()).rejects.toMatchObject({ code: "CONFLICT" });
  memory.basis.mockResolvedValue({
    run: {
      ...run,
      steps: [
        progressStep({ status: "succeeded", session: progressSession([]) }),
      ],
    },
    snapshot,
  });
  await expect(read()).rejects.toMatchObject({ code: "CONFLICT" });
});
