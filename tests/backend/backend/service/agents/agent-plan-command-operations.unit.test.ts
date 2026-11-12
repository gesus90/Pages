import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { fingerprintOperation } from "@/backend/service/agents/AgentOperationRecorder";
import { readPlanCommand } from "@/backend/service/agents/AgentPlanCommandInput";

import {
  ANY_FUNCTION,
  CONTROL,
  TRANSACTION,
  USER,
  database,
  operations,
  plan,
  plans,
  receipt,
  request,
  resetWorld,
  run,
  runJournal,
  stored,
  templates,
  world,
} from "./agent-plan-command-harness";

vi.mock(
  "@/backend/database/repositories/agents/AgentOperationKeyRepository",
  async () => ({
    AgentOperationKeyRepository: (await import("./agent-plan-command-fakes"))
      .FakeOperationKeyRepository,
  }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanRepository",
  async () => ({
    requirePlanRevision: (await import("./agent-plan-command-fakes")).world
      .requireRevision,
  }),
);
vi.mock("@/backend/service/agents/AgentPlanControlViews", async () => ({
  readPlanControlEntry: (await import("./agent-plan-command-fakes")).world
    .readControl,
}));
vi.mock("@/backend/service/agents/AgentPlanTemplateCommands", async () => ({
  AgentPlanTemplateCommands: (await import("./agent-plan-command-fakes"))
    .FakeTemplateCommands,
}));

const TEMPLATE_NODE = { id: "node-1", type: "agent", name: "Reviewer" };

beforeEach(resetWorld);

it("hands template commands to the template commands without reading the plan", async () => {
  world.templateWrite.mockResolvedValue({ action: "plans.templates.delete" });
  const input = { operationId: "op-t" };
  expect(
    await operations().write(USER, "plans.templates.delete", input),
  ).toEqual({ action: "plans.templates.delete" });
  expect(world.templateWrite).toHaveBeenCalledExactlyOnceWith(
    USER,
    "plans.templates.delete",
    input,
  );
  expect(plans.view).not.toHaveBeenCalled();
});

it("rejects malformed command input before any lookup", async () => {
  await expect(
    operations().write(
      USER,
      "plans.pause",
      request("plans.pause", { runId: 4 }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(database.transaction).not.toHaveBeenCalled();
});

it("clones a plan, records the copy and answers with its control state", async () => {
  plans.view.mockResolvedValue(plan({ canEdit: false }));
  plans.clone.mockImplementation((...args: unknown[]) =>
    runJournal(args, "plan-2"),
  );
  world.readControl.mockResolvedValue({ ...CONTROL, planId: "plan-2" });
  const result = await operations().write(
    USER,
    "plans.clone",
    request("plans.clone"),
  );
  expect(plans.clone).toHaveBeenCalledWith(
    USER,
    "plan-1",
    { name: "Copy", expectedRevision: 3 },
    expect.any(Function),
  );
  expect(stored()).toEqual({
    planId: "plan-2",
    revision: 1,
    sourcePlanId: "plan-1",
    sourceRevision: 3,
    workspaceId: "workspace-1",
  });
  expect(world.readControl).toHaveBeenCalledWith(plans, USER, "plan-2");
  expect(result).toMatchObject({
    planId: "plan-2",
    action: "plans.clone",
    status: "idle",
    control: { planId: "plan-2" },
  });
});

it("clones into another workspace when one is named", async () => {
  plans.clone.mockImplementation((...args: unknown[]) =>
    runJournal(args, "plan-2"),
  );
  await operations().write(
    USER,
    "plans.clone",
    request("plans.clone", { workspaceId: "workspace-9" }),
  );
  expect(plans.clone).toHaveBeenCalledWith(
    USER,
    "plan-1",
    { name: "Copy", expectedRevision: 3, workspaceId: "workspace-9" },
    expect.any(Function),
  );
  expect(stored()).toMatchObject({ workspaceId: "workspace-9" });
});

it("refuses to change a plan the account cannot edit", async () => {
  plans.view.mockResolvedValue(plan({ canEdit: false }));
  await expect(
    operations().write(USER, "plans.play", request("plans.play")),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(plans.play).not.toHaveBeenCalled();
});

it("reports the current revision when the expected one is stale", async () => {
  plans.view.mockResolvedValue(plan({ revision: 5 }));
  await expect(
    operations().write(USER, "plans.play", request("plans.play")),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    details: { currentRevision: 5 },
  });
});

it("lets only the owner delete a plan", async () => {
  plans.view.mockResolvedValue(plan({ ownerId: "someone-else" }));
  await expect(
    operations().write(USER, "plans.delete", request("plans.delete")),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(plans.remove).not.toHaveBeenCalled();
});

it.each([
  ["no confirmation field", {}],
  ["a legacy confirmation word", { confirmation: "LÖSCHEN" }],
  ["a wrong legacy confirmation word", { confirmation: "wrong" }],
])(
  "deletes a plan with %s, recording in the commit of the deletion",
  async (label, overrides) => {
    plans.remove.mockImplementation(
      async (
        user: string,
        planId: string,
        options: { journal: (transaction: unknown) => Promise<void> },
      ) => options.journal(TRANSACTION),
    );
    const result = await operations().write(
      USER,
      "plans.delete",
      request("plans.delete", overrides),
    );
    expect(plans.remove).toHaveBeenCalledWith(USER, "plan-1", {
      revision: 3,
      journal: ANY_FUNCTION,
    });
    expect(stored()).toEqual({ planId: "plan-1", revision: 3, deleted: true });
    expect(result).toEqual({
      planId: "plan-1",
      revision: 3,
      deleted: true,
      action: "plans.delete",
      status: "deleted",
    });
    expect(world.readControl).not.toHaveBeenCalled();
  },
);

it("saves a template from a top-level node", async () => {
  plans.view.mockResolvedValue(plan({ nodes: [TEMPLATE_NODE] }));
  templates.save.mockImplementation((...args: unknown[]) =>
    runJournal(args, { id: "template-1" }),
  );
  const result = await operations().write(
    USER,
    "plans.templates.save",
    request("plans.templates.save"),
  );
  expect(templates.save).toHaveBeenCalledWith(
    USER,
    { planId: "plan-1", workspaceId: "workspace-1" },
    { name: "Template", node: TEMPLATE_NODE },
    expect.any(Function),
  );
  expect(world.requireRevision).toHaveBeenCalledWith(TRANSACTION, "plan-1", 3);
  expect(stored()).toEqual({
    planId: "plan-1",
    revision: 3,
    templateId: "template-1",
  });
  expect(result).toMatchObject({
    action: "plans.templates.save",
    templateId: "template-1",
    status: "idle",
  });
});

it("saves a template from a step inside a group", async () => {
  const step = { id: "node-1", type: "agent", name: "Inner" };
  plans.view.mockResolvedValue(
    plan({ nodes: [{ id: "group-1", type: "group", steps: [step] }] }),
  );
  templates.save.mockImplementation((...args: unknown[]) =>
    runJournal(args, { id: "template-1" }),
  );
  await operations().write(
    USER,
    "plans.templates.save",
    request("plans.templates.save"),
  );
  expect(templates.save).toHaveBeenCalledWith(
    USER,
    expect.anything(),
    { name: "Template", node: step },
    expect.any(Function),
  );
});

it.each([
  ["an unknown node", []],
  [
    "a node that is no template node",
    [{ id: "node-1", type: "loop", steps: [] }],
  ],
])("refuses to save a template from %s", async (label, nodes) => {
  plans.view.mockResolvedValue(plan({ nodes }));
  await expect(
    operations().write(
      USER,
      "plans.templates.save",
      request("plans.templates.save"),
    ),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "element_missing" },
  });
  expect(templates.save).not.toHaveBeenCalled();
});

it("plays a plan, recording the run under the operation", async () => {
  plans.play.mockImplementation((...args: unknown[]) =>
    runJournal(args, { id: "run-1" }),
  );
  plans.run.mockResolvedValue(
    run({ continuation: { planRevision: 4 }, status: "running" }),
  );
  const result = await operations().write(
    USER,
    "plans.play",
    request("plans.play"),
  );
  expect(plans.play).toHaveBeenCalledWith(
    USER,
    "plan-1",
    3,
    expect.objectContaining({ recordStartRejection: ANY_FUNCTION }),
  );
  expect(world.requireRevision).toHaveBeenCalledWith(TRANSACTION, "plan-1", 3);
  expect(stored()).toEqual({ planId: "plan-1", revision: 3, runId: "run-1" });
  expect(result).toMatchObject({
    runId: "run-1",
    action: "plans.play",
    status: "running",
    planRevision: 4,
    control: CONTROL,
  });
});

it("keeps a command receipt of the run and skips the control read", async () => {
  plans.play.mockImplementation((...args: unknown[]) =>
    runJournal(args, { id: "run-1", command: receipt("accepted") }),
  );
  const result = await operations().write(
    USER,
    "plans.play",
    request("plans.play"),
  );
  expect(stored()).toMatchObject({ command: receipt("accepted") });
  expect(result).toEqual({
    planId: "plan-1",
    revision: 3,
    runId: "run-1",
    command: receipt("accepted"),
    action: "plans.play",
  });
  expect(world.readControl).not.toHaveBeenCalled();
});

it("answers a refused start with the stored findings of the graph check", async () => {
  const issues = [{ nodeId: "node-1", port: null, problem: "remoteModel" }];
  plans.play.mockImplementation(
    async (
      user: string,
      planId: string,
      revision: number,
      journal: { recordStartRejection: (...input: unknown[]) => Promise<void> },
    ) => {
      await journal.recordStartRejection(TRANSACTION, {
        error: "plan_invalid",
        issues,
        issueDetailsFiltered: true,
      });
      throw new AgentError("plan_invalid");
    },
  );
  await expect(
    operations().write(USER, "plans.play", request("plans.play")),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "graph_invalid", issues, issueDetailsFiltered: true },
  });
  expect(stored()).toEqual({
    planId: "plan-1",
    revision: 3,
    rejection: "plan_invalid",
    issues,
    issueDetailsFiltered: true,
  });
});

it("answers a refused start without findings with its fixed reason", async () => {
  plans.play.mockImplementation(
    async (
      user: string,
      planId: string,
      revision: number,
      journal: { recordStartRejection: (...input: unknown[]) => Promise<void> },
    ) => {
      await journal.recordStartRejection(TRANSACTION, {
        error: "plan_run_unavailable",
      });
      throw new AgentError("plan_run_unavailable");
    },
  );
  await expect(
    operations().write(USER, "plans.play", request("plans.play")),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "plan_run_unavailable" },
  });
  expect(stored()).toEqual({
    planId: "plan-1",
    revision: 3,
    rejection: "plan_run_unavailable",
  });
});

it.each([
  ["plans.resume", "resume"],
  ["plans.pause", "pause"],
  ["plans.stop", "stop"],
] as const)("%s drives the named own run", async (operation, method) => {
  plans[method].mockImplementation((...args: unknown[]) =>
    runJournal(args, { id: "run-1" }),
  );
  const result = await operations().write(USER, operation, request(operation));
  if (method === "resume")
    expect(plans.resume).toHaveBeenCalledWith(
      USER,
      "run-1",
      3,
      expect.any(Function),
    );
  else
    expect(plans[method]).toHaveBeenCalledWith(
      USER,
      "run-1",
      expect.any(Function),
    );
  expect(stored()).toEqual({ planId: "plan-1", revision: 3, runId: "run-1" });
  expect(result).toMatchObject({ action: operation, runId: "run-1" });
});

it("reads a run to stop through the control read and others through the run read", async () => {
  plans.stop.mockImplementation((...args: unknown[]) =>
    runJournal(args, { id: "run-1" }),
  );
  const result = await operations().write(
    USER,
    "plans.stop",
    request("plans.stop"),
  );
  expect(plans.controlRun).toHaveBeenCalledWith(USER, "run-1");
  expect(plans.run).not.toHaveBeenCalled();
  expect(result).toMatchObject({ status: "stopping" });
});

it.each([
  ["another plan", { planId: "plan-2" }],
  ["another account", { userId: "someone-else" }],
  ["another run id", { id: "run-9" }],
])("treats a run of %s as missing", async (label, changes) => {
  plans.run.mockResolvedValue(run(changes));
  await expect(
    operations().write(USER, "plans.pause", request("plans.pause")),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(plans.pause).not.toHaveBeenCalled();
});

it("returns the committed result when another call stored the operation first", async () => {
  plans.play.mockImplementation(async (...args: unknown[]) => {
    world.findOverride = () => ({
      operation: "plans.play",
      fingerprint: fingerprintOperation(
        readPlanCommand("plans.play", request("plans.play")),
      ),
      resultJson: JSON.stringify({
        planId: "plan-1",
        revision: 3,
        runId: "run-1",
      }),
    });
    await runJournal(args, { id: "run-2" });
  });
  const result = await operations().write(
    USER,
    "plans.play",
    request("plans.play"),
  );
  expect(result).toMatchObject({ runId: "run-1", action: "plans.play" });
  expect(world.keys.size).toBe(0);
});

it("returns an earlier result when the failed change had committed meanwhile", async () => {
  let lookups = 0;
  world.findOverride = () => {
    lookups += 1;
    return lookups === 1
      ? null
      : {
          operation: "plans.pause",
          fingerprint: fingerprintOperation(
            readPlanCommand("plans.pause", request("plans.pause")),
          ),
          resultJson: JSON.stringify({
            planId: "plan-1",
            revision: 3,
            runId: "run-1",
          }),
        };
  };
  plans.pause.mockRejectedValue(new Error("connection lost"));
  const result = await operations().write(
    USER,
    "plans.pause",
    request("plans.pause"),
  );
  expect(result).toMatchObject({ runId: "run-1", action: "plans.pause" });
});

it("rethrows a failure when no result was stored", async () => {
  const failure = new Error("connection lost");
  plans.pause.mockRejectedValue(failure);
  await expect(
    operations().write(USER, "plans.pause", request("plans.pause")),
  ).rejects.toBe(failure);
});

it("serializes calls so a second one sees the first one's stored result", async () => {
  plans.pause.mockImplementation((...args: unknown[]) =>
    runJournal(args, { id: "run-1" }),
  );
  const target = operations();
  const [first, second] = await Promise.all([
    target.write(USER, "plans.pause", request("plans.pause")),
    target.write(USER, "plans.pause", request("plans.pause")),
  ]);
  expect(plans.pause).toHaveBeenCalledTimes(1);
  expect(second).toEqual(first);
});
