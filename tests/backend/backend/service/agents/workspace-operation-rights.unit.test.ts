import { beforeEach, describe, expect, it, vi } from "vitest";

import { CAPABILITY } from "@/definition/Authorization";

import { WorkspaceWorld } from "./workspace-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesystemModule } = await import("./memory-filesystem");
  return memoryFilesystemModule();
});

let world = new WorkspaceWorld();
let workspaceId = "";

beforeEach(() => {
  world = new WorkspaceWorld();
  world.addProject("engineering", { departments: ["engineering"] });
  world.addProject("design", { departments: ["design"] });
  world.addPerson("admin", { isAdmin: true });
  world.addPerson("manager");
  world.addManager("engineering", "manager");
  world.addPerson("scoped", {
    capabilities: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
    managedDepartments: ["engineering"],
  });
  world.addPerson("everywhere", {
    capabilities: [CAPABILITY.MANAGE_PROJECTS],
    allProjects: true,
  });
  world.addPerson("writer", { capabilities: [CAPABILITY.WRITE] });
  world.addPerson("unscoped", {
    capabilities: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
  });
  world.addPerson("outsider", {
    isDepartmentBound: true,
    departments: ["design"],
  });
  workspaceId = world.seed({
    name: "Seeded",
    path: "/work/seeded",
    projectId: "engineering",
  });
});

function create(userId: string, operationId: string): Promise<unknown> {
  return world.call(userId, "workspaces.create", {
    operationId,
    name: "Created",
    path: world.directory(`/work/created-${operationId}`),
    projectId: "engineering",
  });
}

function update(userId: string): Promise<unknown> {
  return world.call(userId, "workspaces.update", {
    operationId: `update-${userId}`,
    workspaceId,
    expectedRevision: 1,
    name: "Renamed",
  });
}

function remove(userId: string): Promise<unknown> {
  return world.call(userId, "workspaces.remove", {
    operationId: `remove-${userId}`,
    workspaceId,
    expectedRevision: 1,
  });
}

describe.each(["admin", "manager", "scoped", "everywhere"])(
  "%s may manage the workspaces of the project",
  (userId) => {
    it("creates, changes and removes", async () => {
      await expect(create(userId, `create-${userId}`)).resolves.toMatchObject({
        changed: true,
        revision: 1,
      });
      await expect(update(userId)).resolves.toMatchObject({
        changed: true,
        revision: 2,
      });
      await expect(
        world.call(userId, "workspaces.remove", {
          operationId: `remove-${userId}`,
          workspaceId,
          expectedRevision: 2,
        }),
      ).resolves.toMatchObject({ removed: true, revision: null });
    });
  },
);

describe.each(["writer", "unscoped"])(
  "%s can open the project but may not manage it",
  (userId) => {
    it("is refused on every write and nothing is stored", async () => {
      await expect(create(userId, `create-${userId}`)).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
      await expect(update(userId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(remove(userId)).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(world.writes).toEqual({ saves: 0, removals: 0 });
      expect(world.keys.size).toBe(0);
      expect(world.stored()).toHaveLength(1);
    });

    it("still reads the workspace and sees that it may not manage it", async () => {
      await expect(
        world.call(userId, "workspaces.read", { workspaceId }),
      ).resolves.toMatchObject({ workspace: { canManage: false } });
    });
  },
);

it("refuses a change that would alter nothing just the same", async () => {
  await expect(
    world.call("writer", "workspaces.update", {
      operationId: "same-values",
      workspaceId,
      expectedRevision: 1,
      name: "Seeded",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(world.keys.size).toBe(0);
});

it("hides the project from a person who cannot open it", async () => {
  await expect(create("outsider", "create-outsider")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(update("outsider")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(remove("outsider")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("reports the management hint of every person", async () => {
  const hints = await Promise.all(
    ["admin", "manager", "scoped", "writer", "unscoped"].map(async (userId) => {
      const result = await world.call(userId, "workspaces.read", {
        workspaceId,
      });
      return [userId, result] as const;
    }),
  );

  expect(
    hints.map(([userId, result]) => [
      userId,
      (result as { workspace: { canManage: boolean } }).workspace.canManage,
    ]),
  ).toEqual([
    ["admin", true],
    ["manager", true],
    ["scoped", true],
    ["writer", false],
    ["unscoped", false],
  ]);
});

it("checks the rights again on every call", async () => {
  await expect(update("manager")).resolves.toMatchObject({ changed: true });

  world.removeManager("engineering", "manager");

  await expect(
    world.call("manager", "workspaces.update", {
      operationId: "update-again",
      workspaceId,
      expectedRevision: 2,
      name: "Again",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("needs the right on the project a workspace moves to", async () => {
  world.addProject("shared");

  await expect(
    world.call("manager", "workspaces.update", {
      operationId: "move-shared",
      workspaceId,
      expectedRevision: 1,
      projectId: "shared",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(world.stored()[0].projectId).toBe("engineering");
});

it("hides a target project the person cannot open", async () => {
  world.addPerson("bound", {
    isDepartmentBound: true,
    departments: ["engineering"],
  });
  world.addManager("engineering", "bound");

  await expect(
    world.call("bound", "workspaces.update", {
      operationId: "move-hidden",
      workspaceId,
      expectedRevision: 1,
      projectId: "design",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("does not widen with an inactive account", async () => {
  world.changePerson("manager", { isActive: false });

  await expect(update("manager")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

describe("the folder browser of the create dialog", () => {
  const request = { path: null, showHidden: false } as const;

  it.each(["manager", "scoped", "everywhere"])(
    "is open to %s, who may register workspaces",
    async (userId) => {
      await expect(
        world.registry.folders(userId, request),
      ).resolves.toHaveProperty("path");
    },
  );

  it("is open to an administrator in administrator mode", async () => {
    world.addPerson("ui-admin", { isAdmin: true, mode: "admin" });

    await expect(
      world.registry.folders("ui-admin", request),
    ).resolves.toMatchObject({ hasSeveralRoots: false });
  });

  it.each(["writer", "unscoped", "outsider"])(
    "is closed to %s, who may not register workspaces",
    async (userId) => {
      await expect(
        world.registry.folders(userId, request),
      ).rejects.toMatchObject({ code: "workspace_management_denied" });
    },
  );
});
