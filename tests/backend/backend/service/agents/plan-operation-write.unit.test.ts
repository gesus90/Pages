import { beforeEach, expect, it } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  PlanWorld,
  REVIEWER,
  runnablePlan,
  WORKSPACE,
} from "./plan-operation-world";

import type {
  AgentPlanChanged,
  AgentPlanDetail,
  AgentPlanRead,
} from "@/definition/AgentPlanOperations";

let world: PlanWorld;

async function refusal(
  promise: Promise<unknown>,
): Promise<AgentOperationError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AgentOperationError) return error;
    throw error;
  }
  throw new Error("The call was not refused.");
}

async function read(userId: string, planId: string): Promise<AgentPlanDetail> {
  const { plan } = (await world.call(userId, "plans.read", {
    planId,
  })) as AgentPlanRead;
  return plan;
}

async function change(
  userId: string,
  operation: string,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentPlanChanged> {
  return (await world.call(userId, operation, parameters)) as AgentPlanChanged;
}

beforeEach(() => {
  world = new PlanWorld();
  world.seed(runnablePlan("plan-a"));
});

it("creates a runnable plan in one call and reads it back", async () => {
  const created = await change("owner", "plans.create", {
    operationId: "create-1",
    name: "Built over MCP",
    workspaceId: WORKSPACE,
    changes: [
      { action: "addNode", node: { type: "start", id: "begin" } },
      {
        action: "addNode",
        node: {
          type: "agent",
          id: "work",
          agentId: REVIEWER,
          instruction: "Do it.",
        },
      },
      { action: "addNode", node: { type: "end", id: "finish" } },
      { action: "connect", from: "begin", to: "work" },
      { action: "connect", from: "work", to: "finish" },
    ],
  });

  const plan = await read("owner", created.planId);
  expect(created).toEqual({
    planId: created.planId,
    changed: true,
    revision: 1,
    createdNodeIds: ["begin", "work", "finish"],
  });
  expect(plan).toMatchObject({
    name: "Built over MCP",
    canEdit: true,
    revision: 1,
    sharing: { scope: "private" },
    edges: [
      { from: "begin", to: "work" },
      { from: "work", to: "finish" },
    ],
    status: { isRunnable: true, state: "idle", runCount: 0 },
  });
  // Like the editor, the new agent node got a value node for its directory.
  const directory = plan.nodes.find((node) => node.type === "parameter");
  expect(directory).toMatchObject({
    name: "repository",
    value: { type: "workspace", workspaceId: WORKSPACE },
  });
  expect(plan.nodes.find((node) => node.id === "work")).toMatchObject({
    instruction: "Do it.",
    bindings: { repository: { kind: "source", nodeId: directory?.id } },
  });
});

it("shares a new plan only when asked to", async () => {
  const created = await change("owner", "plans.create", {
    operationId: "create-shared",
    name: "Shared",
    workspaceId: WORKSPACE,
    sharing: { scope: "global" },
  });

  expect((await read("reader", created.planId)).canEdit).toBe(false);
});

it("refuses a workspace the person cannot use", async () => {
  const refused = await refusal(
    world.call("outsider", "plans.create", {
      operationId: "create-2",
      name: "Elsewhere",
      workspaceId: WORKSPACE,
    }),
  );

  expect(refused.code).toBe("INVALID_REQUEST");
  expect(refused.details).toEqual({ reason: "workspace_unavailable" });
  expect(world.saves).toBe(0);
});

it("adds, connects, binds and removes nodes; the stored structure reads back", async () => {
  const changed = await change("owner", "plans.update", {
    operationId: "update-1",
    planId: "plan-a",
    expectedRevision: 1,
    name: "Review and check",
    changes: [
      {
        action: "addNode",
        node: { type: "agent", id: "check", agentId: REVIEWER, x: 960, y: 0 },
      },
      { action: "disconnect", from: "review", to: "end" },
      { action: "connect", from: "review", to: "check" },
      { action: "connect", from: "check", to: "end" },
      {
        action: "bind",
        nodeId: "check",
        parameter: "notes",
        binding: { kind: "result", stepId: "review" },
      },
      { action: "unbind", nodeId: "review", parameter: "ticket" },
      { action: "removeNode", nodeId: "ticket" },
      {
        action: "updateNode",
        nodeId: "review",
        fields: { instruction: "Review carefully.", x: 300 },
      },
    ],
  });

  const plan = await read("owner", "plan-a");
  expect(changed).toMatchObject({
    changed: true,
    revision: 2,
    createdNodeIds: ["check"],
  });
  expect(plan.name).toBe("Review and check");
  expect(plan.revision).toBe(2);
  expect(plan.nodes.map((node) => node.id)).not.toContain("ticket");
  const flow = { fromPort: "flow-out", toPort: "flow-in" };
  expect(plan.edges).toEqual([
    { from: "start", to: "review", ...flow },
    { from: "review", to: "check", ...flow },
    { from: "check", to: "end", ...flow },
  ]);
  expect(plan.nodes.find((node) => node.id === "check")).toMatchObject({
    bindings: { notes: { kind: "result", stepId: "review" } },
  });
  expect(plan.nodes.find((node) => node.id === "review")).toMatchObject({
    x: 300,
    instruction: "Review carefully.",
    bindings: { repository: { kind: "source", nodeId: "directory" } },
  });
  expect(plan.status.isRunnable).toBe(true);
});

it("refuses a graph the plan page refuses and writes nothing", async () => {
  const refused = await refusal(
    world.call("owner", "plans.update", {
      operationId: "cycle",
      planId: "plan-a",
      expectedRevision: 1,
      changes: [{ action: "connect", from: "review", to: "start" }],
    }),
  );

  expect(refused.code).toBe("INVALID_REQUEST");
  expect(refused.details).toMatchObject({ reason: "graph_invalid" });
  expect(
    refused.details && "issues" in refused.details
      ? refused.details.issues.map((issue) => issue.problem)
      : [],
  ).toContain("port");
  expect((await read("owner", "plan-a")).revision).toBe(1);
  expect(world.keys.size).toBe(0);
});

it.each([
  [{ action: "removeNode", nodeId: "nothing" }, "element_missing"],
  [{ action: "disconnect", from: "start", to: "end" }, "element_missing"],
  [
    { action: "unbind", nodeId: "review", parameter: "notes" },
    "element_missing",
  ],
  [
    { action: "updateNode", nodeId: "start", fields: { instruction: "x" } },
    "element_missing",
  ],
  [{ action: "connect", from: "start", to: "review" }, "element_exists"],
  [{ action: "addNode", node: { type: "end", id: "end" } }, "element_exists"],
])("refuses the change %j with %s", async (entry, reason) => {
  const refused = await refusal(
    world.call("owner", "plans.update", {
      operationId: "bad",
      planId: "plan-a",
      expectedRevision: 1,
      changes: [entry],
    }),
  );

  expect(refused.code).toBe("INVALID_REQUEST");
  expect(refused.details).toEqual({ reason });
});

it("answers a stale revision with the current one and changes nothing", async () => {
  await change("owner", "plans.update", {
    operationId: "rename",
    planId: "plan-a",
    expectedRevision: 1,
    name: "Renamed",
  });

  const refused = await refusal(
    world.call("owner", "plans.update", {
      operationId: "stale",
      planId: "plan-a",
      expectedRevision: 1,
      name: "Lost",
    }),
  );

  expect(refused.code).toBe("CONFLICT");
  expect(refused.details).toEqual({ currentRevision: 2 });
  expect((await read("owner", "plan-a")).name).toBe("Renamed");
});

it("reports a request that matches the stored plan as unchanged", async () => {
  const result = await change("owner", "plans.update", {
    operationId: "same",
    planId: "plan-a",
    expectedRevision: 1,
    name: "Review plan",
  });

  expect(result).toEqual({
    planId: "plan-a",
    changed: false,
    revision: 1,
    createdNodeIds: [],
  });
  expect(world.saves).toBe(0);
});

it("returns the stored result when a call is repeated and refuses the ID for another request", async () => {
  const parameters = {
    operationId: "repeat",
    planId: "plan-a",
    expectedRevision: 1,
    changes: [{ action: "addNode", node: { type: "end" } }],
  };
  const first = await change("owner", "plans.update", parameters);
  const again = await change("owner", "plans.update", parameters);
  const other = await refusal(
    world.call("owner", "plans.update", { ...parameters, name: "Other" }),
  );

  expect(again).toEqual(first);
  expect(world.saves).toBe(1);
  expect(other.code).toBe("CONFLICT");
});

it("creates, changes and removes one parameter; every change reads back", async () => {
  const created = await change("owner", "plans.parameter.create", {
    operationId: "parameter-create",
    planId: "plan-a",
    expectedRevision: 1,
    name: "branch",
    value: { type: "text", text: "main" },
  });
  const [parameterId] = created.createdNodeIds;
  const afterCreate = await read("owner", "plan-a");

  await change("owner", "plans.parameter.update", {
    operationId: "parameter-update",
    planId: "plan-a",
    expectedRevision: 2,
    parameterId,
    name: "limit",
    value: { type: "number", number: 3 },
    format: "number",
  });
  const afterUpdate = await read("owner", "plan-a");

  await change("owner", "plans.parameter.remove", {
    operationId: "parameter-remove",
    planId: "plan-a",
    expectedRevision: 3,
    parameterId,
  });
  const afterRemove = await read("owner", "plan-a");

  expect(
    afterCreate.nodes.find((node) => node.id === parameterId),
  ).toMatchObject({
    type: "parameter",
    name: "branch",
    format: "string",
    value: { type: "text", text: "main" },
  });
  expect(
    afterUpdate.nodes.find((node) => node.id === parameterId),
  ).toMatchObject({
    name: "limit",
    format: "number",
    value: { type: "number", number: 3 },
  });
  expect(afterRemove.nodes.some((node) => node.id === parameterId)).toBe(false);
  expect(afterRemove.revision).toBe(4);
});

it("removes a parameter together with the inputs it fed", async () => {
  await change("owner", "plans.parameter.remove", {
    operationId: "remove-directory",
    planId: "plan-a",
    expectedRevision: 1,
    parameterId: "directory",
  });

  const review = (await read("owner", "plan-a")).nodes.find(
    (node) => node.id === "review",
  );
  expect(review).toMatchObject({
    bindings: { ticket: { kind: "source", nodeId: "ticket" } },
  });
  expect(
    review && "bindings" in review ? review.bindings.repository : null,
  ).toBeUndefined();
});

it("refuses a taken name, a value of the wrong format and a node that is no parameter", async () => {
  const taken = await refusal(
    world.call("owner", "plans.parameter.create", {
      operationId: "taken",
      planId: "plan-a",
      expectedRevision: 1,
      name: "repository",
      value: { type: "text", text: "x" },
    }),
  );
  const malformed = await refusal(
    world.call("owner", "plans.parameter.create", {
      operationId: "malformed",
      planId: "plan-a",
      expectedRevision: 1,
      name: "data",
      format: "json",
      value: { type: "text", text: "{not json" },
    }),
  );
  const notParameter = await refusal(
    world.call("owner", "plans.parameter.update", {
      operationId: "not-parameter",
      planId: "plan-a",
      expectedRevision: 1,
      parameterId: "review",
      name: "other",
    }),
  );

  expect(taken.details).toEqual({ reason: "element_exists" });
  expect(malformed.details).toEqual({ reason: "parameter_value_invalid" });
  expect(notParameter.code).toBe("NOT_FOUND");
  expect(world.saves).toBe(0);
});

it("refuses to rename a parameter to a name another parameter holds, and allows keeping its own", async () => {
  const created = await change("owner", "plans.parameter.create", {
    operationId: "second-parameter",
    planId: "plan-a",
    expectedRevision: 1,
    name: "limit",
    value: { type: "number", number: 1 },
    format: "number",
  });
  const [secondId] = created.createdNodeIds;

  const taken = await refusal(
    world.call("owner", "plans.parameter.update", {
      operationId: "rename-taken",
      planId: "plan-a",
      expectedRevision: 2,
      parameterId: secondId,
      name: "repository",
    }),
  );
  await change("owner", "plans.parameter.update", {
    operationId: "keep-name",
    planId: "plan-a",
    expectedRevision: 2,
    parameterId: secondId,
    name: "limit",
    value: { type: "number", number: 2 },
    format: "number",
  });

  expect(taken.details).toEqual({ reason: "element_exists" });
  expect((await read("owner", "plan-a")).revision).toBe(3);
});

it("lets only the owner change a plan; a hidden plan is missing", async () => {
  world.seed({ ...runnablePlan("plan-private"), usage: "private" });

  const shared = await refusal(
    world.call("reader", "plans.update", {
      operationId: "foreign",
      planId: "plan-a",
      expectedRevision: 1,
      name: "Taken over",
    }),
  );
  const sharedParameter = await refusal(
    world.call("reader", "plans.parameter.remove", {
      operationId: "foreign-parameter",
      planId: "plan-a",
      expectedRevision: 1,
      parameterId: "directory",
    }),
  );
  const hidden = await refusal(
    world.call("reader", "plans.update", {
      operationId: "hidden",
      planId: "plan-private",
      expectedRevision: 1,
      name: "Seen",
    }),
  );
  const outsider = await refusal(
    world.call("outsider", "plans.update", {
      operationId: "outsider",
      planId: "plan-a",
      expectedRevision: 1,
      name: "Seen",
    }),
  );

  expect([shared.code, sharedParameter.code]).toEqual([
    "FORBIDDEN",
    "FORBIDDEN",
  ]);
  expect([hidden.code, outsider.code]).toEqual(["NOT_FOUND", "NOT_FOUND"]);
  expect(world.saves).toBe(0);
  expect((await read("owner", "plan-a")).name).toBe("Review plan");
});

it("does not hand a stored result to someone who lost the plan", async () => {
  const parameters = {
    operationId: "kept",
    planId: "plan-a",
    expectedRevision: 1,
    name: "Mine",
  };
  await change("owner", "plans.update", parameters);
  world.members.delete("owner");

  const refused = await refusal(
    world.call("owner", "plans.update", parameters),
  );

  expect(refused.code).toBe("NOT_FOUND");
});

it("refuses credentials in a plan", async () => {
  const refused = await refusal(
    world.call("owner", "plans.update", {
      operationId: "secret",
      planId: "plan-a",
      expectedRevision: 1,
      changes: [
        {
          action: "updateNode",
          nodeId: "review",
          fields: {
            instruction:
              "Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
          },
        },
      ],
    }),
  );

  expect(refused.details).toEqual({ reason: "credentials_in_text" });
});
