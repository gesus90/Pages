import { beforeEach, expect, it, vi } from "vitest";

import { renderAgentDefinition } from "@/backend/service/agents/AgentDefinitionFiles";

import { memoryFiles } from "./page-agent-files";
import { AGENTS_DIRECTORY, PageAgentWorld } from "./page-agent-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

interface Changed {
  readonly id: string;
  readonly changed: boolean;
  readonly revision: number;
}

interface AgentView {
  readonly name: string;
  readonly instruction: string;
  readonly parameters: readonly unknown[];
  readonly directoryParameter: string | null;
  readonly modelProfileId: string;
  readonly reasoningEffort: string | null;
  readonly ownerId: string;
  readonly revision: number;
  readonly sharing: {
    readonly scope: string;
    readonly operator: string | null;
    readonly groups: readonly { readonly id: string }[];
    readonly departments: readonly { readonly id: string }[];
  };
}

let world = new PageAgentWorld();
let sequence = 0;

beforeEach(() => {
  memoryFiles.reset();
  sequence = 0;
  world = new PageAgentWorld();
  world.addPerson("owner");
  world.addPerson("member");
  world.addPerson("outsider");
  world.addDepartment("sales");
  world.addGroup("builders", ["member"]);
  world.addModel("model-1", { efforts: ["low", "medium", "high"] });
  world.addModel("model-2", { efforts: ["low", "medium"], name: "Zeta" });
});

async function create(
  parameters: Readonly<Record<string, unknown>> = {},
  userId = "owner",
): Promise<Changed> {
  const result = await world.call(userId, "agents.create", {
    operationId: `create-${(sequence += 1)}`,
    name: "Reviewer",
    ...parameters,
  });
  return result as Changed;
}

async function read(id: string, userId = "owner"): Promise<AgentView> {
  const result = (await world.call(userId, "agents.read", { agentId: id })) as {
    agent: AgentView;
  };
  return result.agent;
}

async function update(
  id: string,
  expectedRevision: number,
  changes: Readonly<Record<string, unknown>>,
  userId = "owner",
): Promise<Changed> {
  const result = await world.call(userId, "agents.update", {
    operationId: `update-${(sequence += 1)}`,
    agentId: id,
    expectedRevision,
    ...changes,
  });
  return result as Changed;
}

it("creates a private agent for the connected account and reads it back", async () => {
  const created = await create({
    instruction: "Review {{topic}}.",
    parameters: [
      {
        name: "topic",
        type: "text",
        description: "What to review",
        isRequired: true,
        defaultValue: null,
      },
    ],
  });

  expect(created).toMatchObject({ changed: true, revision: 1 });
  expect(await read(created.id)).toMatchObject({
    name: "Reviewer",
    instruction: "Review {{topic}}.",
    ownerId: "owner",
    revision: 1,
    modelProfileId: "model-1",
    reasoningEffort: "medium",
    sharing: { scope: "private", operator: null, groups: [], departments: [] },
    parameters: [
      {
        name: "topic",
        type: "text",
        description: "What to review",
        isRequired: true,
        defaultValue: null,
      },
    ],
  });
});

it("makes the account of the credential the owner and refuses any owner value", async () => {
  for (const field of ["ownerId", "userId", "owner", "authorId"])
    await expect(
      world.call("owner", "agents.create", {
        operationId: `create-${field}`,
        name: "Reviewer",
        [field]: "outsider",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

  const created = await create({}, "member");

  expect(world.storedAgents()).toHaveLength(1);
  expect(world.storedAgents()[0]).toMatchObject({
    id: created.id,
    ownerId: "member",
  });
});

it("stores model, effort and a restricted share with AND and OR", async () => {
  const created = await create({
    modelProfileId: "model-2",
    reasoningEffort: "low",
    sharing: {
      scope: "restricted",
      operator: "and",
      groupIds: ["builders"],
      departmentIds: ["sales"],
    },
  });

  const stored = await read(created.id);
  expect(stored).toMatchObject({
    modelProfileId: "model-2",
    reasoningEffort: "low",
    sharing: {
      scope: "restricted",
      operator: "and",
      groups: [{ id: "builders" }],
      departments: [{ id: "sales" }],
    },
  });
  expect(world.storedAgents()[0].configuration?.sharing).toEqual({
    isGlobal: false,
    targets: [
      { kind: "group", targetId: "builders" },
      { kind: "department", targetId: "sales" },
    ],
    operator: "and",
  });
});

it("changes only the fields that were passed", async () => {
  const created = await create({
    instruction: "Do it.",
    modelProfileId: "model-2",
    reasoningEffort: "low",
    sharing: { scope: "global" },
  });

  const renamed = await update(created.id, 1, { name: "Renamed" });

  expect(renamed).toMatchObject({
    id: created.id,
    changed: true,
    revision: 2,
  });
  expect(await read(created.id)).toMatchObject({
    name: "Renamed",
    instruction: "Do it.",
    modelProfileId: "model-2",
    reasoningEffort: "low",
    sharing: { scope: "global" },
    revision: 2,
  });
});

it("changes every allowed field and reads the same values back", async () => {
  const created = await create();
  const parameters = [
    {
      name: "ticket",
      type: "text",
      description: "Ticket key",
      isRequired: false,
      defaultValue: { type: "text", text: "PAGE-1" },
    },
  ];

  const changed = await update(created.id, 1, {
    name: "Final",
    instruction: "Summarize {{ticket}}.",
    parameters,
    directoryParameter: null,
    modelProfileId: "model-2",
    reasoningEffort: "medium",
    sharing: { scope: "restricted", groupIds: ["builders"] },
  });

  expect(changed).toMatchObject({ changed: true, revision: 2 });
  expect(await read(created.id)).toMatchObject({
    name: "Final",
    instruction: "Summarize {{ticket}}.",
    parameters,
    directoryParameter: null,
    modelProfileId: "model-2",
    reasoningEffort: "medium",
    sharing: {
      scope: "restricted",
      operator: "or",
      groups: [{ id: "builders" }],
    },
    ownerId: "owner",
    revision: 2,
  });
});

it("keeps one revision per change and no-ops a request that matches", async () => {
  const created = await create({ sharing: { scope: "global" } });
  const writes = world.writes.profiles;

  const same = await update(created.id, 1, {
    name: "Reviewer",
    sharing: { scope: "global" },
  });

  expect(same).toMatchObject({ changed: false, revision: 1 });
  expect(world.writes.profiles).toBe(writes);
  expect((await read(created.id)).revision).toBe(1);
});

it("lets the owner end and restart a share and returns to private", async () => {
  const created = await create({ sharing: { scope: "global" } });
  expect(await world.call("outsider", "agents.list", {})).toMatchObject({
    total: 1,
  });

  await update(created.id, 1, { sharing: { scope: "private" } });

  expect(await world.call("outsider", "agents.list", {})).toMatchObject({
    total: 0,
  });
  expect((await read(created.id)).sharing.scope).toBe("private");
});

it("does not give a person who may use the agent the right to change it", async () => {
  const created = await create({ sharing: { scope: "global" } });

  await expect(
    update(created.id, 1, { name: "Taken over" }, "member"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await read(created.id)).name).toBe("Reviewer");
});

it("answers an agent the person cannot see like a missing one", async () => {
  const created = await create();

  await expect(
    update(created.id, 1, { name: "x" }, "outsider"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(update("no-such-agent", 1, { name: "x" })).rejects.toMatchObject(
    { code: "NOT_FOUND" },
  );
});

it("never changes an agent of the administration", async () => {
  await expect(
    update("model-1", 1, { name: "Taken over" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(world.stored().find((entry) => entry.id === "model-1")).toMatchObject({
    name: "Model model-1",
  });
});

it("refuses a stale revision with the current one and changes nothing", async () => {
  const created = await create();
  await update(created.id, 1, { name: "First" });

  await expect(update(created.id, 1, { name: "Second" })).rejects.toMatchObject(
    {
      code: "CONFLICT",
      details: { currentRevision: 2 },
    },
  );
  expect((await read(created.id)).name).toBe("First");
});

it("refuses a change that was lost to a concurrent save in the same moment", async () => {
  const created = await create();

  const results = await Promise.allSettled([
    update(created.id, 1, { name: "First" }),
    update(created.id, 1, { name: "Second" }),
  ]);

  const outcomes = results.map((entry) => entry.status).sort();
  expect(outcomes).toEqual(["fulfilled", "rejected"]);
  const refusal = results.find((entry) => entry.status === "rejected");
  expect(refusal).toMatchObject({
    reason: { code: "CONFLICT", details: { currentRevision: 2 } },
  });
});

it("writes the definition file of the agent in step with the stored definition", async () => {
  const created = await create({ instruction: "Do it." });
  const file = `${AGENTS_DIRECTORY}/${created.id}/AGENT.md`;

  expect(memoryFiles.files()).toEqual([file]);
  const stored = world.storedAgents()[0];
  expect(memoryFiles.read(file)).toBe(renderAgentDefinition(stored));

  await update(created.id, 1, { name: "Renamed" });

  const changed = world.storedAgents()[0];
  expect(memoryFiles.files()).toEqual([file]);
  expect(memoryFiles.read(file)).toBe(renderAgentDefinition(changed));
  expect(memoryFiles.read(file)).toContain("Renamed");
});

it("keeps the stored definition when its file cannot be written", async () => {
  memoryFiles.failWrites();
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  const created = await create();

  expect(world.storedAgents()).toHaveLength(1);
  expect(await read(created.id)).toMatchObject({ name: "Reviewer" });
  expect(spy).toHaveBeenCalled();
});

it("stops at the limit of agents per person", async () => {
  for (let index = 0; index < 100; index += 1)
    world.seedAgent({
      id: `agent-${index}`,
      ownerId: "owner",
      modelProfileId: "model-1",
    });

  await expect(create()).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "agent_limit_reached" },
  });
  await expect(create({}, "member")).resolves.toMatchObject({
    changed: true,
  });
});
