import { beforeEach, expect, it, vi } from "vitest";

import { memoryFiles } from "./page-agent-files";
import { PageAgentWorld } from "./page-agent-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

interface Changed {
  readonly id: string;
  readonly changed: boolean;
  readonly revision: number;
}

let world = new PageAgentWorld();

beforeEach(() => {
  memoryFiles.reset();
  world = new PageAgentWorld();
  world.addPerson("owner");
  world.addPerson("other");
  world.addModel("model-1", { efforts: ["low", "medium"] });
});

function createInput(
  operationId: string,
  name = "Reviewer",
): Readonly<Record<string, unknown>> {
  return { operationId, name, instruction: "Review." };
}

async function created(): Promise<Changed> {
  const result = await world.call("owner", "agents.create", createInput("c-1"));
  return result as Changed;
}

it("creates one agent when the same call is repeated after a lost response", async () => {
  const first = await created();
  const repeated = await world.call(
    "owner",
    "agents.create",
    createInput("c-1"),
  );

  expect(repeated).toEqual(first);
  expect(world.storedAgents()).toHaveLength(1);
  expect(world.writes.profiles).toBe(1);
  expect(memoryFiles.files()).toHaveLength(1);
});

it("answers a parallel repetition with the same agent", async () => {
  const [first, second] = await Promise.all([
    world.call("owner", "agents.create", createInput("c-1")),
    world.call("owner", "agents.create", createInput("c-1")),
  ]);

  expect(second).toEqual(first);
  expect(world.storedAgents()).toHaveLength(1);
  expect(world.keys.size).toBe(1);
});

it("refuses an operation ID that was used with other parameters", async () => {
  const first = await created();

  await expect(
    world.call("owner", "agents.create", createInput("c-1", "Another name")),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    world.call("owner", "agents.update", {
      operationId: "c-1",
      agentId: first.id,
      expectedRevision: 1,
      name: "Another name",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(world.storedAgents()).toHaveLength(1);
  expect(world.storedAgents()[0].name).toBe("Reviewer");
});

it("keeps one operation ID per person", async () => {
  await created();

  const other = await world.call(
    "other",
    "agents.create",
    createInput("c-1", "Mine"),
  );

  expect(other).toMatchObject({ changed: true });
  expect(world.storedAgents()).toHaveLength(2);
});

it("shows the stored result of a repeated call even after the agent changed", async () => {
  const first = await created();
  await world.call("owner", "agents.update", {
    operationId: "u-1",
    agentId: first.id,
    expectedRevision: 1,
    name: "Renamed",
  });

  const repeated = await world.call(
    "owner",
    "agents.create",
    createInput("c-1"),
  );

  expect(repeated).toEqual(first);
  expect(world.storedAgents()).toHaveLength(1);
});

it("applies an update once when it is repeated after a lost response", async () => {
  const first = await created();
  const parameters = {
    operationId: "u-1",
    agentId: first.id,
    expectedRevision: 1,
    name: "Renamed",
  };

  const changed = await world.call("owner", "agents.update", parameters);
  const repeated = await world.call("owner", "agents.update", parameters);

  expect(repeated).toEqual(changed);
  expect(changed).toMatchObject({ changed: true, revision: 2 });
  expect(world.storedAgents()[0]).toMatchObject({ revision: 2 });
  expect(world.writes.profiles).toBe(2);
});

it("answers a parallel repetition of an update with one change", async () => {
  const first = await created();
  const parameters = {
    operationId: "u-1",
    agentId: first.id,
    expectedRevision: 1,
    name: "Renamed",
  };

  const [one, two] = await Promise.all([
    world.call("owner", "agents.update", parameters),
    world.call("owner", "agents.update", parameters),
  ]);

  expect(two).toEqual(one);
  expect(world.storedAgents()[0]).toMatchObject({ revision: 2 });
});

it("stores a no-op result so that its repetition is stable", async () => {
  const first = await created();
  const parameters = {
    operationId: "u-1",
    agentId: first.id,
    expectedRevision: 1,
    name: "Reviewer",
  };

  const noOp = await world.call("owner", "agents.update", parameters);
  await world.call("owner", "agents.update", {
    operationId: "u-2",
    agentId: first.id,
    expectedRevision: 1,
    name: "Renamed",
  });
  const repeated = await world.call("owner", "agents.update", parameters);

  expect(noOp).toMatchObject({ changed: false, revision: 1 });
  expect(repeated).toEqual(noOp);
});

it("does not keep an operation ID for a call that was refused", async () => {
  world.withdrawModel("model-1");

  await expect(
    world.call("owner", "agents.create", createInput("c-1")),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(world.keys.size).toBe(0);

  world.addModel("model-1", { efforts: ["low", "medium"] });
  const retry = await world.call("owner", "agents.create", createInput("c-1"));

  expect(retry).toMatchObject({ changed: true });
  expect(world.keys.size).toBe(1);
});

it("hides a stored result from a person who no longer owns the agent", async () => {
  const first = await created();
  world.replace({
    ...world.stored().filter((entry) => entry.id === first.id)[0],
    ownerId: "other",
  });

  await expect(
    world.call("owner", "agents.create", createInput("c-1")),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
