import { beforeEach, expect, it, vi } from "vitest";

import { WorkspaceWorld } from "./workspace-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesystemModule } = await import("./memory-filesystem");
  return memoryFilesystemModule();
});

interface Changed {
  readonly id: string;
  readonly projectId: string;
  readonly changed: boolean;
  readonly revision: number | null;
  readonly removed: boolean;
}

let world = new WorkspaceWorld();

beforeEach(() => {
  world = new WorkspaceWorld();
  world.addProject("linked");
  world.addPerson("admin", { isAdmin: true });
  world.addPerson("manager");
  world.addManager("linked", "manager");
  world.addPerson("other", { isAdmin: true });
});

function createInput(
  operationId: string,
  path = "/work/repo",
): Readonly<Record<string, unknown>> {
  return {
    operationId,
    name: "Repo",
    path: world.directory(path),
    projectId: "linked",
  };
}

async function created(): Promise<Changed> {
  const result = await world.call(
    "admin",
    "workspaces.create",
    createInput("create-1"),
  );
  return result as Changed;
}

it("creates one workspace when the same call is repeated after a lost response", async () => {
  const first = await created();
  const repeated = await world.call(
    "admin",
    "workspaces.create",
    createInput("create-1"),
  );

  expect(repeated).toEqual(first);
  expect(world.stored()).toHaveLength(1);
  expect(world.writes.saves).toBe(1);
  expect(first).toMatchObject({ changed: true, revision: 1, removed: false });
});

it("answers a parallel repetition with the same registration", async () => {
  const [first, second] = await Promise.all([
    world.call("admin", "workspaces.create", createInput("create-1")),
    world.call("admin", "workspaces.create", createInput("create-1")),
  ]);

  expect(second).toEqual(first);
  expect(world.stored()).toHaveLength(1);
  expect(world.keys.size).toBe(1);
});

it("refuses an operation ID that was used with other parameters", async () => {
  await created();

  await expect(
    world.call("admin", "workspaces.create", {
      ...createInput("create-1"),
      name: "Another name",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    world.call("admin", "workspaces.remove", {
      operationId: "create-1",
      workspaceId: "anything",
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(world.stored()[0].name).toBe("Repo");
});

it("keeps one operation ID per person", async () => {
  await created();

  const other = await world.call(
    "other",
    "workspaces.create",
    createInput("create-1", "/work/second"),
  );

  expect(other).toMatchObject({ changed: true });
  expect(world.stored()).toHaveLength(2);
});

it("shows the stored result of a repeated call even after the workspace changed", async () => {
  const first = await created();
  await world.call("other", "workspaces.update", {
    operationId: "rename-other",
    workspaceId: first.id,
    expectedRevision: 1,
    name: "Renamed by someone else",
  });

  const repeated = await world.call(
    "admin",
    "workspaces.create",
    createInput("create-1"),
  );

  expect(repeated).toEqual(first);
  expect(world.stored()[0]).toMatchObject({
    name: "Renamed by someone else",
    revision: 2,
  });
});

it("refuses a repeated call once the person may no longer manage the project", async () => {
  world.addPerson("manager-2");
  world.addManager("linked", "manager-2");
  await world.call("manager-2", "workspaces.create", createInput("create-m"));

  world.removeManager("linked", "manager-2");

  await expect(
    world.call("manager-2", "workspaces.create", createInput("create-m")),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("does not use up an operation ID with a refused call", async () => {
  world.addPerson("writer");

  await expect(
    world.call("writer", "workspaces.create", createInput("create-w")),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(world.keys.size).toBe(0);

  world.addManager("linked", "writer");

  await expect(
    world.call("writer", "workspaces.create", createInput("create-w")),
  ).resolves.toMatchObject({ changed: true });
});

it("refuses a stale revision and keeps the value another person set", async () => {
  const { id } = await created();
  await world.call("other", "workspaces.update", {
    operationId: "rename-other",
    workspaceId: id,
    expectedRevision: 1,
    name: "Renamed by someone else",
  });

  const stale = world.call("admin", "workspaces.update", {
    operationId: "rename-admin",
    workspaceId: id,
    expectedRevision: 1,
    name: "Renamed by me",
  });

  await expect(stale).rejects.toMatchObject({
    code: "CONFLICT",
    details: { currentRevision: 2 },
  });
  expect(world.stored()[0]).toMatchObject({
    name: "Renamed by someone else",
    revision: 2,
  });
  expect(world.keys.size).toBe(2);
});

it("lets only one of two parallel changes of the same revision through", async () => {
  const { id } = await created();

  const outcomes = await Promise.allSettled(
    ["first", "second"].map((name) =>
      world.call("admin", "workspaces.update", {
        operationId: `rename-${name}`,
        workspaceId: id,
        expectedRevision: 1,
        name,
      }),
    ),
  );

  expect(outcomes.map(({ status }) => status).sort()).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect(world.stored()[0].revision).toBe(2);
});

it("answers parallel repetitions of one change with its single result", async () => {
  const { id } = await created();
  const input = {
    operationId: "rename-once",
    workspaceId: id,
    expectedRevision: 1,
    name: "Renamed once",
  };

  const [first, second] = await Promise.all([
    world.call("admin", "workspaces.update", input),
    world.call("admin", "workspaces.update", input),
  ]);

  expect(second).toEqual(first);
  expect(first).toMatchObject({ changed: true, revision: 2 });
  expect(world.writes.saves).toBe(2);
});

it("reports an unchanged workspace without writing and repeats that answer", async () => {
  const { id } = await created();
  const input = {
    operationId: "same",
    workspaceId: id,
    expectedRevision: 1,
    name: "Repo",
    path: "/work/repo",
  };

  const first = await world.call("admin", "workspaces.update", input);
  const repeated = await world.call("admin", "workspaces.update", input);

  expect(first).toMatchObject({ changed: false, revision: 1 });
  expect(repeated).toEqual(first);
  expect(world.writes.saves).toBe(1);
  expect(world.stored()[0].revision).toBe(1);
});

it("needs something to change", async () => {
  const { id } = await created();

  await expect(
    world.call("admin", "workspaces.update", {
      operationId: "nothing",
      workspaceId: id,
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("refuses a stale revision on removal and repeats a completed removal", async () => {
  const { id } = await created();

  await expect(
    world.call("admin", "workspaces.remove", {
      operationId: "remove-stale",
      workspaceId: id,
      expectedRevision: 5,
    }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    details: { currentRevision: 1 },
  });
  const input = {
    operationId: "remove",
    workspaceId: id,
    expectedRevision: 1,
  };
  const first = await world.call("admin", "workspaces.remove", input);
  const repeated = await world.call("admin", "workspaces.remove", input);

  expect(first).toMatchObject({ removed: true, revision: null });
  expect(repeated).toEqual(first);
  expect(world.writes.removals).toBe(1);
});

it("requires the operation ID and the revision where the contract names them", async () => {
  await expect(
    world.call("admin", "workspaces.create", {
      name: "Repo",
      path: "/work/repo",
      projectId: "linked",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    world.call("admin", "workspaces.update", {
      operationId: "x",
      workspaceId: "y",
      name: "Repo",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    world.call("admin", "workspaces.remove", {
      operationId: "x",
      workspaceId: "y",
      expectedRevision: 0,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});
