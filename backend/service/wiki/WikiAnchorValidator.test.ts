import { expect, it, vi } from "vitest";

import { validateAnchors } from "./WikiAnchorValidator";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { WikiVisibilityScope } from "@/definition/Wiki";

interface Target {
  readonly departmentIds: string[];
  readonly projectId: string | null;
}

function repositoryOf(target: Target | null): WikiRepository {
  return {
    anchors: { findAnchorTarget: vi.fn(async () => target) },
  } as unknown as WikiRepository;
}

const viewer: WikiVisibilityScope = {
  departmentIds: ["d1"],
  isAdmin: false,
  projectIds: ["p1"],
  userId: "u",
};
const projectPlacement = { projectId: "p1", scope: "project" } as const;
const instancePlacement = { projectId: null, scope: "instance" } as const;

it("removes duplicate anchors", async () => {
  const anchor = { kind: "milestone", targetId: "m" } as const;

  await expect(
    validateAnchors(
      repositoryOf({ departmentIds: [], projectId: "p1" }),
      viewer,
      projectPlacement,
      [anchor, anchor],
    ),
  ).resolves.toEqual([anchor]);
});

it("accepts no anchors on a private page", async () => {
  await expect(
    validateAnchors(
      repositoryOf(null),
      viewer,
      { projectId: null, scope: "private" },
      [{ kind: "milestone", targetId: "m" }],
    ),
  ).rejects.toThrow();
  await expect(
    validateAnchors(
      repositoryOf(null),
      viewer,
      { projectId: null, scope: "private" },
      [],
    ),
  ).resolves.toEqual([]);
});

it("rejects a target that does not exist", async () => {
  await expect(
    validateAnchors(repositoryOf(null), viewer, instancePlacement, [
      { kind: "epic", targetId: "e" },
    ]),
  ).rejects.toThrow();
});

it("checks the department of a department anchor", async () => {
  const target = { departmentIds: [], projectId: null };
  const own = { kind: "department", targetId: "d1" } as const;
  const foreign = { kind: "department", targetId: "d2" } as const;

  await expect(
    validateAnchors(repositoryOf(target), viewer, instancePlacement, [own]),
  ).resolves.toEqual([own]);
  await expect(
    validateAnchors(repositoryOf(target), viewer, instancePlacement, [foreign]),
  ).rejects.toThrow();
  await expect(
    validateAnchors(
      repositoryOf(target),
      { ...viewer, isAdmin: true },
      instancePlacement,
      [foreign],
    ),
  ).resolves.toEqual([foreign]);
});

it("accepts a readable target of the same project", async () => {
  const anchor = { kind: "epic", targetId: "e" } as const;

  await expect(
    validateAnchors(
      repositoryOf({ departmentIds: ["d1"], projectId: "p1" }),
      viewer,
      projectPlacement,
      [anchor],
    ),
  ).resolves.toEqual([anchor]);
  await expect(
    validateAnchors(
      repositoryOf({ departmentIds: ["d9"], projectId: "p1" }),
      { ...viewer, isAdmin: true },
      instancePlacement,
      [anchor],
    ),
  ).resolves.toEqual([anchor]);
});

it("rejects a target of another project", async () => {
  await expect(
    validateAnchors(
      repositoryOf({ departmentIds: [], projectId: "p2" }),
      viewer,
      projectPlacement,
      [{ kind: "epic", targetId: "e" }],
    ),
  ).rejects.toThrow();
});

it("rejects a target of a project the viewer cannot read", async () => {
  await expect(
    validateAnchors(
      repositoryOf({ departmentIds: [], projectId: "p2" }),
      viewer,
      instancePlacement,
      [{ kind: "epic", targetId: "e" }],
    ),
  ).rejects.toThrow();
  await expect(
    validateAnchors(
      repositoryOf({ departmentIds: [], projectId: null }),
      viewer,
      instancePlacement,
      [{ kind: "epic", targetId: "e" }],
    ),
  ).rejects.toThrow();
});

it("rejects a target of a hidden department", async () => {
  await expect(
    validateAnchors(
      repositoryOf({ departmentIds: ["d9"], projectId: "p1" }),
      viewer,
      instancePlacement,
      [{ kind: "epic", targetId: "e" }],
    ),
  ).rejects.toThrow();
});
