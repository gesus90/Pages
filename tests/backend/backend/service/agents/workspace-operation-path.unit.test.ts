import { beforeEach, describe, expect, it, vi } from "vitest";

import { memoryFilesystem } from "./memory-filesystem";
import {
  AGENTS_DIRECTORY,
  DATA_DIRECTORY,
  WorkspaceWorld,
} from "./workspace-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesystemModule } = await import("./memory-filesystem");
  return memoryFilesystemModule();
});

let world = new WorkspaceWorld();
let counter = 0;

beforeEach(() => {
  world = new WorkspaceWorld();
  world.addProject("linked");
  world.addProject("unlinked", { github: null });
  world.addPerson("admin", { isAdmin: true });
  counter = 0;
});

function create(path: unknown, projectId = "linked"): Promise<unknown> {
  counter += 1;
  return world.call("admin", "workspaces.create", {
    operationId: `create-${counter}`,
    name: "Workspace",
    path,
    projectId,
  });
}

describe("the path of a new workspace", () => {
  it.each([
    ["a URL", "https://github.com/example/repo"],
    ["a git address", "git@github.com:example/repo.git"],
    ["an ssh URL", "ssh://host/srv/repo"],
    ["a file URL", "file:///work/repo"],
    ["a host and path", "server:/exports/repo"],
    ["a network share", "//server/share/repo"],
    ["a backslash share", "\\\\server\\share\\repo"],
    ["a relative path", "work/repo"],
    ["a home shortcut", "~/repo"],
    ["a path with a parent step", "/work/../srv/repo"],
    ["the filesystem root", "/"],
    ["an empty text", "   "],
    ["a number", 42],
  ])("refuses %s", async (_, path) => {
    await expect(create(path)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(world.writes.saves).toBe(0);
    expect(world.stored()).toHaveLength(0);
  });

  it("must exist", async () => {
    await expect(create("/work/not-there")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("must be a directory", async () => {
    memoryFilesystem.addFile("/work/notes.txt");

    await expect(create("/work/notes.txt")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("must be readable, writable and traversable by the server account", async () => {
    memoryFilesystem.addDirectory("/work/locked");
    memoryFilesystem.deny("/work/locked");

    await expect(create("/work/locked")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it.each([
    ["the data folder", DATA_DIRECTORY],
    ["a folder inside the data folder", `${DATA_DIRECTORY}/wiki`],
    ["the agent folder", AGENTS_DIRECTORY],
    ["a folder that holds the instance folders", "/srv/pages"],
  ])("never is %s of the instance", async (_, path) => {
    memoryFilesystem.addDirectory(path);

    await expect(create(path)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("is stored in its canonical form without any environment variable", async () => {
    memoryFilesystem.addDirectory("/mnt/projects/repo");
    memoryFilesystem.addLink("/work/shortcut", "/mnt/projects/repo");

    const created = await create("/work/shortcut");

    expect(created).toMatchObject({ changed: true, revision: 1 });
    expect(world.stored()[0].path).toBe("/mnt/projects/repo");
  });
});

describe("the project of a new workspace", () => {
  it("needs a GitHub link", async () => {
    memoryFilesystem.addDirectory("/work/repo");

    await expect(create("/work/repo", "unlinked")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(world.stored()).toHaveLength(0);
  });

  it("must exist and be visible", async () => {
    memoryFilesystem.addDirectory("/work/repo");

    await expect(create("/work/repo", "nowhere")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("is not changed by the operations, whatever they do", async () => {
    const before = world.links();
    const path = world.directory("/work/repo");

    const created = (await create(path)) as { id: string };
    await world.call("admin", "workspaces.update", {
      operationId: "rename",
      workspaceId: created.id,
      expectedRevision: 1,
      name: "Renamed",
    });
    await world.call("admin", "workspaces.remove", {
      operationId: "remove",
      workspaceId: created.id,
      expectedRevision: 2,
    });

    expect(world.links()).toEqual(before);
  });

  it("cannot be moved to a project without a GitHub link", async () => {
    const id = world.seed({ path: "/work/repo", projectId: "linked" });

    await expect(
      world.call("admin", "workspaces.update", {
        operationId: "move",
        workspaceId: id,
        expectedRevision: 1,
        projectId: "unlinked",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(world.stored()[0].projectId).toBe("linked");
  });
});

describe("what the operations do to the directory", () => {
  it("only looks at directories and leaves every entry as it was", async () => {
    memoryFilesystem.addFile("/work/repo/README.md");
    memoryFilesystem.addFile("/work/repo/src/index.ts");
    const before = memoryFilesystem.snapshot();
    memoryFilesystem.calls.length = 0;

    const created = (await create("/work/repo")) as { id: string };
    await world.call("admin", "workspaces.update", {
      operationId: "rename",
      workspaceId: created.id,
      expectedRevision: 1,
      name: "Renamed",
    });
    await world.call("admin", "workspaces.remove", {
      operationId: "remove",
      workspaceId: created.id,
      expectedRevision: 2,
    });

    expect(memoryFilesystem.snapshot()).toEqual(before);
    expect(
      memoryFilesystem.calls.filter(
        (call) => !["realpath", "stat", "access"].includes(call),
      ),
    ).toEqual([]);
  });

  it("keeps the directory, its files and the project when a workspace is removed", async () => {
    memoryFilesystem.addFile("/work/repo/README.md");
    const id = world.seed({ path: "/work/repo", projectId: "linked" });

    await world.call("admin", "workspaces.remove", {
      operationId: "remove",
      workspaceId: id,
      expectedRevision: 1,
    });

    expect(world.stored()).toHaveLength(0);
    expect(memoryFilesystem.has("/work/repo")).toBe(true);
    expect(memoryFilesystem.has("/work/repo/README.md")).toBe(true);
    expect(world.links()).toContain("linked=https://github.com/example/linked");
  });

  it("keeps a workspace that plans or agents still refer to", async () => {
    const id = world.seed({ path: "/work/repo", projectId: "linked" });
    world.addUsage(id);

    await expect(
      world.call("admin", "workspaces.remove", {
        operationId: "remove",
        workspaceId: id,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(world.stored()).toHaveLength(1);
    expect(world.keys.size).toBe(0);
  });

  it("refuses a directory another workspace registers or overlaps", async () => {
    world.seed({ path: "/work/repo", projectId: "linked" });
    memoryFilesystem.addDirectory("/work/repo/packages/app");
    memoryFilesystem.addDirectory("/work");

    await expect(create("/work/repo")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(create("/work/repo/packages/app")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(create("/work")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
