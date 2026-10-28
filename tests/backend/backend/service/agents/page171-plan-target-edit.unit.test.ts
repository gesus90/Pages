import { expect, it } from "vitest";

import { PlanWorld, runnablePlan, WORKSPACE } from "./plan-operation-world";

it("preserves a remote plan target when MCP renames or moves an existing node", async () => {
  const world = new PlanWorld();
  const target = { kind: "remote", workspaceId: "remote-one" } as const;
  const base = runnablePlan("remote");
  world.seed({
    ...base,
    executionTarget: target,
    nodes: base.nodes.map((node) =>
      node.id === "review" && node.type === "agent"
        ? {
            ...node,
            executionTarget: { kind: "remote", workspaceId: "override" },
          }
        : node,
    ),
  });
  const rename = {
    operationId: "rename",
    planId: "remote",
    expectedRevision: 1,
    name: "Renamed remotely targeted plan",
  };
  await world.call("owner", "plans.update", rename);
  expect(world.plans.get("remote")?.executionTarget).toEqual(target);
  expect(
    world.plans.get("remote")?.nodes.find((node) => node.id === "review"),
  ).toMatchObject({
    executionTarget: { kind: "remote", workspaceId: "override" },
  });
  await world.call("owner", "plans.update", {
    operationId: "move",
    planId: "remote",
    expectedRevision: 2,
    changes: [
      { action: "updateNode", nodeId: "review", fields: { x: 745, y: 212 } },
    ],
  });
  expect(world.plans.get("remote")?.executionTarget).toEqual(target);
  expect(world.runs).toHaveLength(0);
});

it("reads and explicitly changes the default target without changing node overrides", async () => {
  const world = new PlanWorld();
  const target = { kind: "remote", workspaceId: "remote-one" } as const;
  const base = runnablePlan("remote");
  world.seed({
    ...base,
    executionTarget: target,
    nodes: base.nodes.map((node) =>
      node.id === "review" && node.type === "agent"
        ? {
            ...node,
            executionTarget: { kind: "remote", workspaceId: "override" },
          }
        : node,
    ),
  });
  expect(
    await world.call("owner", "plans.read", { planId: "remote" }),
  ).toMatchObject({
    plan: { executionTarget: target },
  });
  const request = {
    operationId: "choose-local",
    planId: "remote",
    expectedRevision: 1,
    executionTarget: { kind: "local" },
  };
  await expect(
    world.call("reader", "plans.update", request),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(world.plans.get("remote")?.executionTarget).toEqual(target);
  const changed = await world.call("owner", "plans.update", request);
  expect(changed).toMatchObject({ changed: true, revision: 2 });
  expect(await world.call("owner", "plans.update", request)).toEqual(changed);
  expect(world.plans.get("remote")?.executionTarget).toEqual({ kind: "local" });
  expect(
    world.plans.get("remote")?.nodes.find((node) => node.id === "review"),
  ).toMatchObject({
    executionTarget: { kind: "remote", workspaceId: "override" },
  });
  expect(world.runs).toHaveLength(0);
  await expect(
    world.call("owner", "plans.update", { ...request, operationId: "stale" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    world.call("owner", "plans.update", {
      ...request,
      operationId: "same-target",
      expectedRevision: 2,
    }),
  ).resolves.toMatchObject({ changed: false, revision: 2 });
});

it("accepts a valid target at creation and rejects malformed target objects", async () => {
  const world = new PlanWorld();
  const target = { kind: "remote", workspaceId: "remote-one" };
  const created = await world.call("owner", "plans.create", {
    operationId: "create-target",
    name: "Remote target plan",
    workspaceId: WORKSPACE,
    executionTarget: target,
  });
  expect(created).toMatchObject({ revision: 1, changed: true });
  expect([...world.plans.values()][0]?.executionTarget).toEqual(target);
  await expect(
    world.call("owner", "plans.create", {
      operationId: "bad-target",
      name: "Bad target plan",
      workspaceId: WORKSPACE,
      executionTarget: {
        kind: "remote",
        workspaceId: "remote-one",
        hidden: true,
      },
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(world.runs).toHaveLength(0);
});

it("does not invent a local default for a plan without a stored target", async () => {
  const world = new PlanWorld();
  world.seed(runnablePlan("legacy"));
  expect(
    await world.call("owner", "plans.read", { planId: "legacy" }),
  ).toMatchObject({
    plan: { executionTarget: null },
  });
  await world.call("owner", "plans.update", {
    operationId: "legacy-rename",
    planId: "legacy",
    expectedRevision: 1,
    name: "Legacy target unchanged",
  });
  expect(world.plans.get("legacy")?.executionTarget).toBeUndefined();
  expect(world.runs).toHaveLength(0);
});
