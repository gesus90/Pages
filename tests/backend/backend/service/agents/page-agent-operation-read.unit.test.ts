import { beforeEach, expect, it, vi } from "vitest";

import { PageAgentWorld } from "./page-agent-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

interface Listed {
  readonly agents: readonly {
    readonly id: string;
    readonly name: string;
    readonly canEdit: boolean;
  }[];
  readonly total: number;
  readonly nextCursor: string | null;
}

let world = new PageAgentWorld();

beforeEach(() => {
  world = new PageAgentWorld();
  world.addPerson("owner");
  world.addPerson("member", { departments: ["sales"] });
  world.addPerson("outsider");
  world.addDepartment("sales");
  world.addGroup("builders", ["member"]);
  world.addGroup("auditors", ["member", "outsider"]);
  world.addModel("model-1");
});

async function listed(userId: string, parameters = {}): Promise<Listed> {
  return (await world.call(userId, "agents.list", parameters)) as Listed;
}

it("lists the own agents with their editing right and nothing of others", async () => {
  world.seedAgent({ id: "mine", ownerId: "owner", modelProfileId: "model-1" });
  world.seedAgent({
    id: "his",
    ownerId: "outsider",
    modelProfileId: "model-1",
  });

  const result = await listed("owner");

  expect(result.total).toBe(1);
  expect(result.agents).toMatchObject([{ id: "mine", canEdit: true }]);
});

it("shows an agent shared globally to everyone but only the owner may edit it", async () => {
  world.seedAgent({
    id: "open",
    ownerId: "owner",
    modelProfileId: "model-1",
    isGlobal: true,
  });

  const result = await listed("outsider");

  expect(result.agents).toMatchObject([{ id: "open", canEdit: false }]);
});

it("matches a restricted share with any target for or and with every target for and", async () => {
  const targets = [
    { kind: "group" as const, targetId: "builders" },
    { kind: "department" as const, targetId: "sales" },
  ];
  world.seedAgent({
    id: "any",
    ownerId: "owner",
    modelProfileId: "model-1",
    targets,
    operator: "or",
  });
  world.seedAgent({
    id: "every",
    ownerId: "owner",
    modelProfileId: "model-1",
    targets,
    operator: "and",
  });
  world.addPerson("sales-only", { departments: ["sales"] });

  const member = await listed("member");
  const salesOnly = await listed("sales-only");
  const outsider = await listed("outsider");

  expect(member.agents.map((agent) => agent.id)).toEqual(["any", "every"]);
  expect(salesOnly.agents.map((agent) => agent.id)).toEqual(["any"]);
  expect(outsider.agents).toEqual([]);
  expect(outsider.total).toBe(0);
});

it("counts only visible agents and keeps administrator agents out", async () => {
  world.seedAgent({ id: "mine", ownerId: "owner", modelProfileId: "model-1" });
  world.seedAgent({
    id: "his",
    ownerId: "outsider",
    modelProfileId: "model-1",
  });

  const asOutsider = await listed("outsider");
  const asMember = await listed("member");

  expect(asOutsider.total).toBe(1);
  expect(asMember.total).toBe(0);
  expect(asOutsider.agents.map((agent) => agent.id)).not.toContain("model-1");
});

it("pages by name and continues with the cursor", async () => {
  for (const id of ["c", "a", "b"])
    world.seedAgent({
      id: `agent-${id}`,
      ownerId: "owner",
      modelProfileId: "model-1",
      name: `Agent ${id}`,
    });

  const first = await listed("owner", { limit: 2 });
  const second = await listed("owner", {
    limit: 2,
    cursor: first.nextCursor,
  });

  expect(first.agents.map((agent) => agent.name)).toEqual([
    "Agent a",
    "Agent b",
  ]);
  expect(first.total).toBe(3);
  expect(second.agents.map((agent) => agent.name)).toEqual(["Agent c"]);
  expect(second.nextCursor).toBeNull();
});

it("refuses a cursor of another person and an invalid limit", async () => {
  world.seedAgent({ id: "a", ownerId: "owner", modelProfileId: "model-1" });
  world.seedAgent({ id: "b", ownerId: "owner", modelProfileId: "model-1" });
  const first = await listed("owner", { limit: 1 });

  await expect(
    listed("member", { cursor: first.nextCursor }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(listed("owner", { limit: 0 })).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  await expect(listed("owner", { limit: 101 })).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
});

it("reads one visible agent completely, with names of its targets", async () => {
  world.seedAgent({
    id: "shared",
    ownerId: "owner",
    modelProfileId: "model-1",
    name: "Reviewer",
    targets: [
      { kind: "group", targetId: "builders" },
      { kind: "department", targetId: "sales" },
    ],
    operator: "and",
  });

  const result = await world.call("member", "agents.read", {
    agentId: "shared",
  });

  expect(result).toMatchObject({
    agent: {
      id: "shared",
      name: "Reviewer",
      instruction: "",
      parameters: [],
      directoryParameter: null,
      modelProfileId: "model-1",
      model: "model-model-1",
      reasoningEffort: null,
      ownerId: "owner",
      canEdit: false,
      isUsable: true,
      hasDeletedTargets: false,
      revision: 1,
      run: { access: "workspace_write", shell: false, web: false },
      sharing: {
        scope: "restricted",
        operator: "and",
        groups: [{ id: "builders", name: "Group builders" }],
        departments: [{ id: "sales", name: "Department sales" }],
      },
    },
  });
});

it("answers a hidden agent like a missing one", async () => {
  world.seedAgent({
    id: "secret",
    ownerId: "owner",
    modelProfileId: "model-1",
  });

  const hidden = world.call("outsider", "agents.read", { agentId: "secret" });
  const missing = world.call("outsider", "agents.read", { agentId: "nothing" });

  await expect(hidden).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(missing).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("does not let an administrator model profile be read as an agent", async () => {
  await expect(
    world.call("owner", "agents.read", { agentId: "model-1" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("stops listing an agent once its share ends", async () => {
  world.seedAgent({
    id: "group-only",
    ownerId: "owner",
    modelProfileId: "model-1",
    targets: [{ kind: "group", targetId: "builders" }],
  });
  expect((await listed("member")).total).toBe(1);

  world.removeGroup("builders");

  expect((await listed("member")).total).toBe(0);
  await expect(
    world.call("member", "agents.read", { agentId: "group-only" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("leaves the file system and the table untouched when reading", async () => {
  world.seedAgent({ id: "mine", ownerId: "owner", modelProfileId: "model-1" });

  await listed("owner");
  await world.call("owner", "agents.read", { agentId: "mine" });
  await world.call("owner", "agents.models.list");

  expect(world.writes.profiles).toBe(0);
  expect(world.keys.size).toBe(0);
});
