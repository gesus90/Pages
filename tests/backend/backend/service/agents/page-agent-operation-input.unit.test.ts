import { beforeEach, expect, it, vi } from "vitest";

import { memoryFiles } from "./page-agent-files";
import { PageAgentWorld } from "./page-agent-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

interface Changed {
  readonly id: string;
  readonly revision: number;
}

let world = new PageAgentWorld();
let sequence = 0;

beforeEach(() => {
  memoryFiles.reset();
  sequence = 0;
  world = new PageAgentWorld();
  world.addPerson("owner");
  world.addDepartment("sales");
  world.addGroup("builders", ["owner"]);
  world.addModel("model-1", { efforts: ["low", "medium"] });
});

async function create(
  parameters: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return world.call("owner", "agents.create", {
    operationId: `create-${(sequence += 1)}`,
    name: "Reviewer",
    ...parameters,
  });
}

async function update(
  agentId: string,
  parameters: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return world.call("owner", "agents.update", {
    operationId: `update-${(sequence += 1)}`,
    agentId,
    expectedRevision: 1,
    ...parameters,
  });
}

it("refuses an unknown, missing or malformed parameter before anything is stored", async () => {
  const invalid = [
    { name: "" },
    { name: "x".repeat(201) },
    { name: 7 },
    { instruction: 7 },
    { instruction: "x".repeat(200_001) },
    { parameters: "none" },
    { parameters: [{ name: "Bad Name" }] },
    { directoryParameter: 7 },
    { modelProfileId: "" },
    { reasoningEffort: 3 },
    { sharing: "global" },
    { run: { shell: true } },
    { unknown: true },
  ];

  for (const parameters of invalid)
    await expect(create(parameters)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  await expect(
    world.call("owner", "agents.create", { operationId: "c" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    world.call("owner", "agents.create", { name: "No operation ID" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(world.storedAgents()).toEqual([]);
  expect(world.keys.size).toBe(0);
});

it("names configuration_invalid for a parameter declaration that is not valid", async () => {
  await expect(
    create({
      parameters: [
        {
          name: "Bad Name",
          type: "text",
          description: "",
          isRequired: false,
          defaultValue: null,
        },
      ],
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "configuration_invalid" },
  });
});

it("refuses a share that cannot be stored or shown unambiguously", async () => {
  const invalid = [
    { scope: "restricted" },
    { scope: "restricted", groupIds: [] },
    { scope: "private", groupIds: ["builders"] },
    { scope: "global", departmentIds: ["sales"] },
    { scope: "global", operator: "and" },
    { scope: "restricted", groupIds: ["builders"], operator: "xor" },
    { scope: "everyone" },
    { scope: "restricted", groupIds: [7] },
    { groupIds: ["builders"] },
  ];

  for (const sharing of invalid)
    await expect(create({ sharing })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  expect(world.storedAgents()).toEqual([]);
});

it("names the reason when a share points to a group or department that does not exist", async () => {
  await expect(
    create({ sharing: { scope: "restricted", groupIds: ["gone"] } }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "sharing_target_unavailable" },
  });
  await expect(
    create({ sharing: { scope: "restricted", departmentIds: ["gone"] } }),
  ).rejects.toMatchObject({
    details: { reason: "sharing_target_unavailable" },
  });
});

it("stores one share target once, whatever the order of the ids", async () => {
  world.addGroup("auditors", ["owner"]);

  const result = (await create({
    sharing: {
      scope: "restricted",
      groupIds: ["builders", "auditors", "builders"],
    },
  })) as Changed;

  expect(world.storedAgents()[0].configuration?.sharing.targets).toEqual([
    { kind: "group", targetId: "auditors" },
    { kind: "group", targetId: "builders" },
  ]);
  expect(result.revision).toBe(1);
});

it("refuses undeclared placeholders, credential-shaped text and references that cannot be used", async () => {
  await expect(
    create({ instruction: "Review {{undeclared}}." }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "configuration_invalid" },
  });
  await expect(
    create({ instruction: "Use api_key = abcdefgh12345678 to log in." }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "credentials_in_text" },
  });
  await expect(
    create({
      instruction: "Open {{folder.path}}.",
      parameters: [
        {
          name: "folder",
          type: "workspace",
          description: "",
          isRequired: true,
          defaultValue: { type: "workspace", workspaceId: "workspace-1" },
        },
      ],
      directoryParameter: "folder",
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "parameter_reference_unavailable" },
  });
  expect(world.storedAgents()).toEqual([]);
});

it("requires at least one field for an update", async () => {
  const created = (await create({})) as Changed;

  await expect(update(created.id, {})).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  await expect(
    world.call("owner", "agents.update", {
      operationId: "update-x",
      agentId: created.id,
      name: "No revision",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("never lets a client set what is not part of the agent definition", async () => {
  const created = (await create({})) as Changed;

  for (const field of ["ownerId", "connectionId", "model", "revision", "path"])
    await expect(update(created.id, { [field]: "x" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  await expect(
    update(created.id, { name: "Valid", filePath: "/etc/passwd" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(memoryFiles.files()).toHaveLength(1);
});

it("asks for an explicit share when the stored one names a deleted group", async () => {
  const created = (await create({
    sharing: { scope: "restricted", groupIds: ["builders"], operator: "and" },
  })) as Changed;
  world.removeGroup("builders");

  await expect(update(created.id, { name: "Renamed" })).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "sharing_changes_required" },
  });
  const reread = (await world.call("owner", "agents.read", {
    agentId: created.id,
  })) as { agent: { hasDeletedTargets: boolean } };
  expect(reread.agent.hasDeletedTargets).toBe(true);

  const fixed = await update(created.id, {
    name: "Renamed",
    sharing: { scope: "private" },
  });
  expect(fixed).toMatchObject({ changed: true, revision: 2 });
});
