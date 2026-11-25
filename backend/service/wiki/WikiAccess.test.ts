import { expect, it, vi } from "vitest";

import { canManagePage, describePermissions, WikiAccess } from "./WikiAccess";

import type { WikiViewer } from "./WikiAccess";
import type { User } from "@/definition/User";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const actor = doubleOf<User>({ id: "u1" });

function viewerOf(overrides: Partial<WikiViewer> = {}): WikiViewer {
  return {
    canManageProjects: false,
    canWrite: false,
    scope: {
      departmentIds: [],
      isAdmin: false,
      projectIds: [],
      userId: "u1",
    },
    user: actor,
    ...overrides,
  };
}

it("resolves a viewer with the capabilities and the visibility", async () => {
  const hasCapability = vi.fn(
    async (user: User, capability: string) =>
      user.id === "u1" && capability === "write",
  );
  const access = new WikiAccess(
    {
      workItemVisibility: vi.fn(async () => ({
        departmentIds: ["d1"],
        projectIds: ["p1"],
      })),
    },
    { hasCapability, isManagement: vi.fn(async () => true) },
  );

  await expect(access.resolve(actor)).resolves.toEqual({
    canManageProjects: false,
    canWrite: true,
    scope: {
      canReadPrivate: true,
      departmentIds: ["d1"],
      isAdmin: false,
      projectIds: ["p1"],
      userId: "u1",
    },
    user: actor,
  });
});

it("treats missing lists as an administrator without management", async () => {
  const access = new WikiAccess(
    {
      workItemVisibility: vi.fn(async () => ({
        departmentIds: null,
      })),
    },
    { hasCapability: vi.fn(async () => false) },
  );

  await expect(access.resolve(actor)).resolves.toMatchObject({
    scope: { departmentIds: [], isAdmin: true, projectIds: [] },
  });
  expect((await access.resolve(actor)).scope).not.toHaveProperty(
    "canReadPrivate",
  );
});

it("lets the owner manage every page", () => {
  expect(canManagePage(viewerOf(), { ownerId: "u1", scope: "private" })).toBe(
    true,
  );
});

it("keeps private pages from everybody else", () => {
  const admin = viewerOf({
    scope: { ...viewerOf().scope, isAdmin: true },
  });

  expect(canManagePage(admin, { ownerId: "u2", scope: "private" })).toBe(false);
});

it("lets administrators manage shared pages", () => {
  const admin = viewerOf({
    scope: { ...viewerOf().scope, isAdmin: true },
  });

  expect(canManagePage(admin, { ownerId: "u2", scope: "instance" })).toBe(true);
});

it("lets project managers manage project pages only", () => {
  const manager = viewerOf({ canManageProjects: true });

  expect(canManagePage(manager, { ownerId: "u2", scope: "project" })).toBe(
    true,
  );
  expect(canManagePage(manager, { ownerId: "u2", scope: "instance" })).toBe(
    false,
  );
});

it("describes the permissions of a viewer", () => {
  expect(
    describePermissions(viewerOf({ canWrite: true }), {
      ownerId: "u2",
      scope: "instance",
    }),
  ).toEqual({ canComment: true, canEdit: true, canManage: false });
});
