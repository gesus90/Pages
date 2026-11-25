import { expect, it, vi } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { WikiValidationError } from "@/backend/error/WikiErrors";

import { requireDepth, resolvePlacement } from "./WikiPlacementResolver";

import type {
  WikiPageRecord,
  WikiRepository,
} from "@/backend/database/repositories/WikiRepository";
import type { WikiViewer } from "./WikiAccess";

const viewer = {
  scope: {
    departmentIds: [],
    isAdmin: false,
    projectIds: ["p1"],
    userId: "u1",
  },
} as unknown as WikiViewer;

function repositoryOf(
  parent: Partial<WikiPageRecord> | null,
  levelsAbove = 0,
): WikiRepository {
  return {
    pages: {
      countLevelsAbove: vi.fn(async () => levelsAbove),
      findVisible: vi.fn(async () => parent),
    },
  } as unknown as WikiRepository;
}

const request = { parentId: null, projectId: null, scope: null };

it("rejects a root page without a valid scope", async () => {
  await expect(
    resolvePlacement(repositoryOf(null), viewer, request),
  ).rejects.toBeInstanceOf(WikiValidationError);
});

it("places a root page of the instance", async () => {
  await expect(
    resolvePlacement(repositoryOf(null), viewer, {
      ...request,
      projectId: "ignored",
      scope: "instance",
    }),
  ).resolves.toEqual({
    level: 1,
    parent: null,
    placement: { parentId: null, projectId: null, scope: "instance" },
  });
});

it("places a root page of a readable project", async () => {
  await expect(
    resolvePlacement(repositoryOf(null), viewer, {
      ...request,
      projectId: "p1",
      scope: "project",
    }),
  ).resolves.toMatchObject({
    placement: { parentId: null, projectId: "p1", scope: "project" },
  });
});

it("rejects a project page without a readable project", async () => {
  for (const projectId of [null, "other"]) {
    await expect(
      resolvePlacement(repositoryOf(null), viewer, {
        ...request,
        projectId,
        scope: "project",
      }),
    ).rejects.toBeInstanceOf(WikiValidationError);
  }
});

it("takes scope and project from the parent", async () => {
  const parent: Partial<WikiPageRecord> = { projectId: "p1", scope: "project" };

  await expect(
    resolvePlacement(repositoryOf(parent, 2), viewer, {
      ...request,
      parentId: "parent",
    }),
  ).resolves.toEqual({
    level: 4,
    parent,
    placement: { parentId: "parent", projectId: "p1", scope: "project" },
  });
});

it("rejects a template as parent", async () => {
  await expect(
    resolvePlacement(repositoryOf({ isTemplate: true }), viewer, {
      ...request,
      parentId: "parent",
    }),
  ).rejects.toBeInstanceOf(WikiValidationError);
});

it("rejects a hidden parent", async () => {
  await expect(
    resolvePlacement(repositoryOf(null), viewer, {
      ...request,
      parentId: "parent",
    }),
  ).rejects.toBeInstanceOf(WikiPageNotFoundError);
});

it("limits the depth of the tree", () => {
  expect(() => requireDepth(5, 5)).not.toThrow();
  expect(() => requireDepth(5, 6)).toThrow(WikiValidationError);
});
