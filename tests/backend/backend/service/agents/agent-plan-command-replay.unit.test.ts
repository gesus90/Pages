import { beforeEach, expect, it, vi } from "vitest";

import {
  CONTROL,
  USER,
  operations,
  plan,
  plans,
  receipt,
  request,
  resetWorld,
  run,
  storeEarlier,
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

const PAUSED = { planId: "plan-1", revision: 3, runId: "run-1" };

beforeEach(resetWorld);

it("refuses an operation ID that was used for another operation", async () => {
  storeEarlier("plans.pause", PAUSED);
  await expect(
    operations().write(USER, "plans.stop", request("plans.stop")),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("refuses an operation ID that was used with other parameters", async () => {
  storeEarlier("plans.pause", PAUSED);
  await expect(
    operations().write(
      USER,
      "plans.pause",
      request("plans.pause", { runId: "run-2" }),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("replays a deletion without reading the deleted plan", async () => {
  const input = request("plans.delete");
  storeEarlier(
    "plans.delete",
    { planId: "plan-1", revision: 3, deleted: true },
    input,
  );
  expect(await operations().write(USER, "plans.delete", input)).toEqual({
    planId: "plan-1",
    revision: 3,
    deleted: true,
    action: "plans.delete",
    status: "deleted",
  });
  expect(plans.view).not.toHaveBeenCalled();
});

it("replays a run command after a fresh access check", async () => {
  storeEarlier("plans.pause", PAUSED);
  const result = await operations().write(
    USER,
    "plans.pause",
    request("plans.pause"),
  );
  expect(plans.pause).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    runId: "run-1",
    action: "plans.pause",
    status: "running",
    planRevision: 3,
  });
});

it("refuses to replay for an account that lost the right to edit", async () => {
  storeEarlier("plans.pause", PAUSED);
  plans.view.mockResolvedValue(plan({ canEdit: false }));
  await expect(
    operations().write(USER, "plans.pause", request("plans.pause")),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("treats a replayed run that no longer belongs to the account as missing", async () => {
  storeEarlier("plans.pause", PAUSED);
  plans.run.mockResolvedValue(run({ userId: "someone-else" }));
  await expect(
    operations().write(USER, "plans.pause", request("plans.pause")),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("replays a clone only while the copy stays editable and valid", async () => {
  storeEarlier("plans.clone", {
    planId: "plan-2",
    revision: 1,
    sourcePlanId: "plan-1",
    sourceRevision: 3,
    workspaceId: "workspace-1",
  });
  plans.view.mockImplementation(async (user: string, id: string) =>
    id === "plan-2"
      ? plan({ id: "plan-2", revision: 1, nodes: [{ id: "n" }] })
      : plan({ canEdit: false }),
  );
  const result = await operations().write(
    USER,
    "plans.clone",
    request("plans.clone"),
  );
  expect(plans.checkNodes).toHaveBeenCalledWith(USER, "workspace-1", [
    { id: "n" },
  ]);
  expect(result).toMatchObject({
    planId: "plan-2",
    sourcePlanId: "plan-1",
    sourceRevision: 3,
    workspaceId: "workspace-1",
    action: "plans.clone",
  });
});

it("treats a replayed clone that is no longer editable as missing", async () => {
  storeEarlier("plans.clone", { planId: "plan-2", revision: 1 });
  plans.view.mockImplementation(async (user: string, id: string) =>
    plan({ id, canEdit: id !== "plan-2" }),
  );
  await expect(
    operations().write(USER, "plans.clone", request("plans.clone")),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(plans.checkNodes).not.toHaveBeenCalled();
});

it("replays a template save only while the template still exists", async () => {
  const input = request("plans.templates.save");
  storeEarlier(
    "plans.templates.save",
    { planId: "plan-1", revision: 3, templateId: "template-1" },
    input,
  );
  templates.list.mockResolvedValue([{ id: "template-2" }]);
  await expect(
    operations().write(USER, "plans.templates.save", input),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(templates.list).toHaveBeenCalledWith(USER, "workspace-1");

  templates.list.mockResolvedValue([{ id: "template-1" }]);
  expect(
    await operations().write(USER, "plans.templates.save", input),
  ).toMatchObject({ templateId: "template-1", action: "plans.templates.save" });
});

it("replays a stored command receipt without reading the run again", async () => {
  const stored = { ...receipt("applied"), error: "none" };
  storeEarlier("plans.resume", { ...PAUSED, command: stored });
  const result = await operations().write(
    USER,
    "plans.resume",
    request("plans.resume"),
  );
  expect(result).toEqual({
    ...PAUSED,
    command: stored,
    action: "plans.resume",
  });
  expect(world.readControl).not.toHaveBeenCalled();
});

it("rejects a stored receipt that is not a valid acknowledgement", async () => {
  storeEarlier("plans.resume", { ...PAUSED, command: { id: 4 } });
  await expect(
    operations().write(USER, "plans.resume", request("plans.resume")),
  ).rejects.toThrow();
});

it.each([
  ["not an object", "text"],
  ["null", null],
  ["without a plan", { revision: 3 }],
  ["with a non-text plan", { planId: 4, revision: 3 }],
  ["without a revision", { planId: "plan-1" }],
  ["with a non-numeric revision", { planId: "plan-1", revision: "3" }],
])("refuses a stored result %s as a conflict", async (label, result) => {
  storeEarlier("plans.play", result);
  await expect(
    operations().write(USER, "plans.play", request("plans.play")),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("ignores stored fields of the wrong type while reading the result", async () => {
  storeEarlier("plans.pause", {
    planId: "plan-1",
    revision: 3,
    runId: 7,
    templateId: 8,
    sourcePlanId: 9,
    sourceRevision: "10",
    workspaceId: 11,
  });
  expect(
    await operations().write(USER, "plans.pause", request("plans.pause")),
  ).toEqual({
    planId: "plan-1",
    revision: 3,
    action: "plans.pause",
    status: "idle",
    control: CONTROL,
  });
});

it("replays the fixed reason of a play that was rejected before it started", async () => {
  storeEarlier("plans.play", {
    planId: "plan-1",
    revision: 3,
    rejection: "plan_run_unavailable",
  });
  await expect(
    operations().write(USER, "plans.play", request("plans.play")),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "plan_run_unavailable" },
  });
});

it("replays the graph findings of a rejected play", async () => {
  const issues = [{ nodeId: "node-1", port: "in", problem: "remoteModel" }];
  storeEarlier("plans.play", {
    planId: "plan-1",
    revision: 3,
    rejection: "plan_invalid",
    issues,
    issueDetailsFiltered: true,
  });
  await expect(
    operations().write(USER, "plans.play", request("plans.play")),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "graph_invalid", issues, issueDetailsFiltered: true },
  });
});

it("replays graph findings stored without the filter flag", async () => {
  storeEarlier("plans.play", {
    planId: "plan-1",
    revision: 3,
    rejection: "plan_invalid",
    issues: [],
  });
  await expect(
    operations().write(USER, "plans.play", request("plans.play")),
  ).rejects.toMatchObject({
    details: { reason: "graph_invalid", issues: [] },
  });
});

it.each([
  ["a rejection that is no Pages error code", { rejection: "nonsense" }],
  [
    "findings for a rejection other than plan_invalid",
    { rejection: "plan_run_unavailable", issues: [] },
  ],
  [
    "findings that do not parse",
    { rejection: "plan_invalid", issues: [{ nodeId: 3 }] },
  ],
  [
    "a filter flag that is no boolean",
    { rejection: "plan_invalid", issues: [], issueDetailsFiltered: "yes" },
  ],
])("refuses %s in a stored play as a conflict", async (label, extra) => {
  storeEarlier("plans.play", { planId: "plan-1", revision: 3, ...extra });
  await expect(
    operations().write(USER, "plans.play", request("plans.play")),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("refuses a stored refusal that does not belong to a play of this plan", async () => {
  storeEarlier("plans.pause", { ...PAUSED, rejection: "plan_run_unavailable" });
  await expect(
    operations().write(USER, "plans.pause", request("plans.pause")),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  world.keys.clear();
  storeEarlier("plans.play", {
    planId: "plan-2",
    revision: 3,
    rejection: "plan_run_unavailable",
  });
  await expect(
    operations().write(USER, "plans.play", request("plans.play")),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
