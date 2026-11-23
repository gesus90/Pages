import { expect, it, vi } from "vitest";

import { WorkItemChecklistRevisionRepository } from "./WorkItemChecklistRevisionRepository";

import type { DatabaseValue } from "@/backend/database/Database";

function repositoryOf(rows: DatabaseValue[][]): {
  readonly repository: WorkItemChecklistRevisionRepository;
  readonly execute: ReturnType<
    typeof vi.fn<(s: string, p?: object) => Promise<void>>
  >;
} {
  const execute = vi.fn<(s: string, p?: object) => Promise<void>>(
    async () => {},
  );
  return {
    repository: new WorkItemChecklistRevisionRepository({
      execute,
      query: async () => rows,
    }),
    execute,
  };
}

it("starts at revision one for an unknown checklist", async () => {
  const { repository, execute } = repositoryOf([]);

  await expect(repository.current("w1", "h")).resolves.toBe(1);
  expect(execute).toHaveBeenCalledWith(expect.any(String), {
    work_item_id: "w1",
    revision: 1,
    content_hash: "h",
  });
});

it("keeps the revision while the content stays the same", async () => {
  const { repository, execute } = repositoryOf([["4", "h"]]);

  await expect(repository.current("w1", "h")).resolves.toBe(4);
  expect(execute).not.toHaveBeenCalled();
});

it("raises the revision when the content changed", async () => {
  const { repository } = repositoryOf([["4", "old"]]);

  await expect(repository.current("w1", "new")).resolves.toBe(5);
});

it("always advances, starting from zero", async () => {
  await expect(repositoryOf([]).repository.advance("w1", "h")).resolves.toBe(1);
  await expect(
    repositoryOf([["7"]]).repository.advance("w1", "h"),
  ).resolves.toBe(8);
});
