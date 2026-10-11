import { expect, it } from "vitest";

import {
  planningIdentity,
  planningMilestone,
  useAgentPlanningHarness,
} from "../helpers/agent-planning";

const setup = useAgentPlanningHarness();

async function createMilestone(
  run: Awaited<ReturnType<ReturnType<typeof useAgentPlanningHarness>>>,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await run.planning.milestones.apply(
    planningIdentity,
    "milestone.create",
    planningMilestone(overrides),
  );
  if (!("milestoneId" in response.result))
    throw new Error("Expected milestone creation result.");
  return response.result.milestoneId;
}

it("requires project management, creates exactly once and rechecks project visibility on replay", async () => {
  const run = await setup();
  const input = planningMilestone();
  await expect(
    run.planning.milestones.apply(
      { ...planningIdentity, userId: "writer" },
      "milestone.create",
      input,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const identity = { ...planningIdentity, userId: "manager" };
  const first = await run.planning.milestones.apply(
    identity,
    "milestone.create",
    input,
  );
  expect(
    await run.planning.milestones.apply(identity, "milestone.create", input),
  ).toEqual(first);
  expect(
    await run.database.query(
      "SELECT name, description, status FROM milestones;",
    ),
  ).toEqual([["Release", "Plan", "open"]]);
  expect(run.listener).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ type: "milestone.created" }),
  );
  expect(run.publish).not.toHaveBeenCalled();
  await run.database.execute(
    "DELETE FROM department_members WHERE user_id = 'manager';",
  );
  await expect(
    run.planning.milestones.apply(identity, "milestone.create", input),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it.each(
  (
    [
      ["milestone.setName", "name", "expectedName", "name", "Release", "New"],
      [
        "milestone.setDescription",
        "description",
        "expectedDescription",
        "description",
        "Plan",
        "Updated",
      ],
      [
        "milestone.setStatus",
        "status",
        "expectedStatus",
        "status",
        "open",
        "completed",
      ],
      [
        "milestone.setStartAt",
        "startAt",
        "expectedStartAt",
        "startAt",
        null,
        "2026-01-01",
      ],
      [
        "milestone.setDueAt",
        "dueAt",
        "expectedDueAt",
        "dueAt",
        null,
        "2026-02-01",
      ],
    ] as const
  ).map(([operation, field, expectedKey, valueKey, original, next]) => ({
    operation,
    field,
    expectedKey,
    valueKey,
    original,
    next,
  })),
)(
  "changes just $operation, replays and rejects stale values without altering neighboring fields",
  async ({ operation, field, expectedKey, valueKey, original, next }) => {
    const run = await setup();
    const milestoneId = await createMilestone(run);
    const before = await run.repository.findMilestoneById(milestoneId);
    run.listener.mockClear();
    run.invalidate.mockClear();
    const parameters = {
      operationId: "change",
      milestoneId,
      [expectedKey]: original,
      [valueKey]: next,
    };
    const first = await run.planning.milestones.apply(
      planningIdentity,
      operation,
      parameters,
    );
    expect(first).toMatchObject({
      result: { milestoneId, field, changed: true },
    });
    const after = await run.repository.findMilestoneById(milestoneId);
    if (!after) throw new Error("Expected stored milestone.");
    expect(after).toEqual({
      ...before,
      [field]: next,
      updatedAt: after.updatedAt,
      completedAt: field === "status" ? after.completedAt : before?.completedAt,
    });
    if (field === "status") expect(after.completedAt).not.toBeNull();
    expect(
      await run.planning.milestones.apply(
        planningIdentity,
        operation,
        parameters,
      ),
    ).toEqual(first);
    expect(run.listener).toHaveBeenCalledExactlyOnceWith({
      type: "milestone.updated",
      id: milestoneId,
    });
    expect(run.invalidate).toHaveBeenCalledOnce();
    await expect(
      run.planning.milestones.apply(planningIdentity, operation, {
        ...parameters,
        operationId: "stale",
        [valueKey]: original,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await run.repository.findMilestoneById(milestoneId)).toEqual(after);
    expect(
      await run.planning.milestones.apply(planningIdentity, operation, {
        ...parameters,
        operationId: "already-set",
      }),
    ).toMatchObject({ result: { changed: false } });
    expect(run.listener).toHaveBeenCalledOnce();
    expect(run.publish).not.toHaveBeenCalled();
  },
);

it("adds and removes one dependency, replays both operations and leaves milestones unchanged", async () => {
  const run = await setup();
  const sourceId = await createMilestone(run);
  const targetId = await createMilestone(run, {
    operationId: "target",
    name: "Target",
  });
  const before = await run.repository.findMilestonesByProjectIds(["p1"]);
  const input = {
    operationId: "add",
    projectId: "p1",
    sourceId,
    targetId,
    linkType: "blocks",
  };
  const added = await run.planning.milestones.apply(
    planningIdentity,
    "milestone.dependency.add",
    input,
  );
  expect(added).toMatchObject({
    result: { sourceId, targetId, linkType: "blocks", removed: false },
  });
  expect(
    await run.planning.milestones.apply(
      planningIdentity,
      "milestone.dependency.add",
      input,
    ),
  ).toEqual(added);
  if (!("dependencyId" in added.result))
    throw new Error("Expected dependency result.");
  const removal = {
    operationId: "remove",
    projectId: "p1",
    dependencyId: added.result.dependencyId,
  };
  const removed = await run.planning.milestones.apply(
    planningIdentity,
    "milestone.dependency.remove",
    removal,
  );
  expect(removed).toEqual({
    apiVersion: "1",
    result: { ...added.result, removed: true },
  });
  expect(
    await run.planning.milestones.apply(
      planningIdentity,
      "milestone.dependency.remove",
      removal,
    ),
  ).toEqual(removed);
  expect(await run.repository.findDependenciesByProjectIds(["p1"])).toEqual([]);
  expect(await run.repository.findMilestonesByProjectIds(["p1"])).toEqual(
    before,
  );
  await expect(
    run.planning.milestones.apply(
      planningIdentity,
      "milestone.dependency.remove",
      { ...removal, operationId: "missing" },
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(run.listener.mock.calls.map(([event]) => event.type)).toEqual([
    "milestone.created",
    "milestone.created",
    "milestone.updated",
    "milestone.updated",
  ]);
});

it("creates and links within the caller's transaction without announcing before its commit", async () => {
  const run = await setup();
  const completed = await run.database.transaction(async (transaction) => {
    const source = await run.planning.milestones.createWithin(
      transaction,
      "owner",
      {
        operationId: "source",
        projectId: "p1",
        name: "Source",
        description: "",
        startAt: null,
        dueAt: null,
      },
    );
    const target = await run.planning.milestones.createWithin(
      transaction,
      "owner",
      {
        operationId: "target",
        projectId: "p1",
        name: "Target",
        description: "",
        startAt: null,
        dueAt: null,
      },
    );
    const link = await run.planning.milestones.linkWithin(
      transaction,
      "owner",
      {
        operationId: "link",
        projectId: "p1",
        sourceId: source.result.milestoneId,
        targetId: target.result.milestoneId,
        linkType: "prerequisite",
      },
    );
    expect(run.listener).not.toHaveBeenCalled();
    return [source, target, link];
  });
  for (const outcome of completed) run.planning.announcer.announce(outcome);
  expect(run.listener).toHaveBeenCalledTimes(3);
  expect(
    await run.repository.findDependenciesByProjectIds(["p1"]),
  ).toHaveLength(1);
});

it("rolls back both inner creations and links when the caller fails", async () => {
  const run = await setup();
  await expect(
    run.database.transaction(async (transaction) => {
      await run.planning.milestones.createWithin(transaction, "owner", {
        operationId: "source",
        projectId: "p1",
        name: "Source",
        description: "",
        startAt: null,
        dueAt: null,
      });
      await run.planning.milestones.linkWithin(transaction, "owner", {
        operationId: "link",
        projectId: "p1",
        sourceId: "missing",
        targetId: "missing",
        linkType: "blocks",
      });
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(await run.database.query("SELECT COUNT(*) FROM milestones;")).toEqual([
    [0],
  ]);
  expect(
    await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
  ).toEqual([[0]]);
  expect(run.listener).not.toHaveBeenCalled();
});
