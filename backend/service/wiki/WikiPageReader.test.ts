import { expect, it, vi } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import { WikiPageReader } from "./WikiPageReader";

import type {
  WikiPageRecord,
  WikiRepository,
} from "@/backend/database/repositories/WikiRepository";
import type { WikiVisibilityScope } from "@/definition/Wiki";

const SCOPE: WikiVisibilityScope = {
  departmentIds: [],
  isAdmin: false,
  projectIds: [],
  userId: "u1",
};

const RECORD = { id: "p1", title: "Page" } as unknown as WikiPageRecord;

function repositoryOf(page: WikiPageRecord | null): {
  readonly repository: WikiRepository;
  readonly findVisible: ReturnType<typeof vi.fn>;
} {
  const findVisible = vi.fn(async () => page);

  return {
    findVisible,
    repository: {
      anchors: {
        findAnchors: vi.fn(async () => [{ kind: "epic", targetId: "e" }]),
      },
      pages: {
        findBreadcrumb: vi.fn(async () => [{ id: "root", title: "Root" }]),
        findVisible,
      },
    } as unknown as WikiRepository,
  };
}

it("returns a visible page", async () => {
  const { repository, findVisible } = repositoryOf(RECORD);

  await expect(
    new WikiPageReader(repository).require(SCOPE, "p1"),
  ).resolves.toBe(RECORD);
  expect(findVisible).toHaveBeenCalledWith(SCOPE, "p1");
});

it("rejects a missing or hidden page", async () => {
  const { repository } = repositoryOf(null);

  await expect(
    new WikiPageReader(repository).require(SCOPE, "p1"),
  ).rejects.toBeInstanceOf(WikiPageNotFoundError);
});

it("completes a page with anchors and breadcrumb", async () => {
  const { repository } = repositoryOf(RECORD);

  await expect(
    new WikiPageReader(repository).assemble(RECORD),
  ).resolves.toEqual({
    ...RECORD,
    anchors: [{ kind: "epic", targetId: "e" }],
    breadcrumb: [{ id: "root", title: "Root" }],
  });
});
