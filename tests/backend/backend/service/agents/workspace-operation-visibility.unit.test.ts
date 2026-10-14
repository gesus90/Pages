import { beforeEach, expect, it, vi } from "vitest";

import { memoryFilesystem } from "./memory-filesystem";
import { WorkspaceWorld } from "./workspace-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesystemModule } = await import("./memory-filesystem");
  return memoryFilesystemModule();
});

interface Listing {
  readonly workspaces: readonly { readonly id: string }[];
  readonly total: number;
  readonly nextCursor: string | null;
}

let world = new WorkspaceWorld();
let openId = "";
let hiddenId = "";

beforeEach(() => {
  world = new WorkspaceWorld();
  world.addProject("open");
  world.addProject("legal-only", { departments: ["legal"] });
  world.addPerson("admin", { isAdmin: true });
  world.addPerson("reader", { isDepartmentBound: true });
  openId = world.seed({
    name: "Open",
    path: "/work/open",
    projectId: "open",
  });
  hiddenId = world.seed({
    name: "Legal",
    path: "/work/legal",
    projectId: "legal-only",
  });
});

async function list(
  userId: string,
  parameters: unknown = {},
): Promise<Listing> {
  const result = await world.call(userId, "workspaces.list", parameters);
  return result as Listing;
}

it("lists only workspaces of projects the account can open", async () => {
  const listing = await list("reader");

  expect(listing.workspaces.map(({ id }) => id)).toEqual([openId]);
  expect(listing.total).toBe(1);
  const text = JSON.stringify(listing);
  expect(text).not.toContain("/work/legal");
  expect(text).not.toContain("legal-only");
  expect(text).not.toContain("Legal");
});

it("answers a hidden workspace exactly like a missing one", async () => {
  const hidden = world
    .call("reader", "workspaces.read", { workspaceId: hiddenId })
    .catch((error: unknown) => error);
  const missing = world
    .call("reader", "workspaces.read", { workspaceId: "does-not-exist" })
    .catch((error: unknown) => error);

  expect(await hidden).toMatchObject({ code: "NOT_FOUND", status: 404 });
  expect(await hidden).toEqual(await missing);
});

it("refuses a project filter for a hidden project like one that does not exist", async () => {
  await expect(
    list("reader", { projectId: "legal-only" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(list("reader", { projectId: "nowhere" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("narrows the list to a readable project", async () => {
  const listing = await list("admin", { projectId: "legal-only" });

  expect(listing.workspaces.map(({ id }) => id)).toEqual([hiddenId]);
});

it("shows an administrator every project but not the registration of a vanished one", async () => {
  expect((await list("admin")).total).toBe(2);

  world.removeProject("legal-only");

  expect((await list("admin")).workspaces.map(({ id }) => id)).toEqual([
    openId,
  ]);
  await expect(
    world.call("admin", "workspaces.read", { workspaceId: hiddenId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("returns the stable id and the planning metadata of a workspace", async () => {
  const result = await world.call("reader", "workspaces.read", {
    workspaceId: openId,
  });

  expect(result).toEqual({
    workspace: {
      id: openId,
      name: "Open",
      path: "/work/open",
      projectId: "open",
      projectName: "Project open",
      github: {
        repoUrl: "https://github.com/example/open",
        repoName: "example/open",
      },
      revision: 1,
      isUsable: true,
      unavailableReason: null,
      canManage: false,
    },
  });
});

it("explains why a workspace cannot be used", async () => {
  world.addProject("unlinked", { github: null });
  const unlinkedId = world.seed({
    path: "/work/unlinked",
    projectId: "unlinked",
  });
  memoryFilesystem.removeDirectory("/work/open");

  const unlinked = await world.call("reader", "workspaces.read", {
    workspaceId: unlinkedId,
  });
  const vanished = await world.call("reader", "workspaces.read", {
    workspaceId: openId,
  });

  expect(unlinked).toMatchObject({
    workspace: { isUsable: false, unavailableReason: "github_link_missing" },
  });
  expect(vanished).toMatchObject({
    workspace: { isUsable: false, unavailableReason: "path_unavailable" },
  });
});

it("pages the list in registry order and binds the cursor to its query", async () => {
  world.seed({ name: "Zeta", path: "/work/zeta", projectId: "open" });
  world.seed({ name: "Alpha", path: "/work/alpha", projectId: "open" });

  const first = await list("reader", { limit: 2 });
  const second = await list("reader", { limit: 2, cursor: first.nextCursor });

  expect(first.total).toBe(3);
  expect(first.nextCursor).not.toBeNull();
  expect(second.workspaces).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  await expect(
    list("reader", { limit: 2, cursor: first.nextCursor, projectId: "open" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("refuses unknown parameters on reads", async () => {
  await expect(list("reader", { path: "/work" })).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  await expect(
    world.call("reader", "workspaces.read", {}),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    world.call("reader", "workspaces.read", { workspaceId: openId, extra: 1 }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("does not look at any file while it lists", async () => {
  memoryFilesystem.calls.length = 0;

  await list("admin");

  expect(new Set(memoryFilesystem.calls)).toEqual(
    new Set(["realpath", "stat", "access"]),
  );
});
