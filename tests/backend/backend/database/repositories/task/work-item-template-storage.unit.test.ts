import { describe, expect, it, vi } from "vitest";

import { WorkItemTemplateRepository } from "@/backend/database/repositories/task/WorkItemTemplateRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

function fixture(): {
  repository: WorkItemTemplateRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  const execute = vi.fn().mockResolvedValue(undefined);
  const transaction = partial<DatabaseTransaction>({ execute });
  return {
    repository: new WorkItemTemplateRepository(
      partial<Database>({
        query,
        transaction: async (work) => work(transaction),
      }),
    ),
    query,
    execute,
  };
}

describe("work item template storage", () => {
  it("joins template sharing and checklist rows", async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([
        [
          "t",
          "Template",
          "u",
          "task",
          "Title",
          "Description",
          "normal",
          "all",
          "created",
          "updated",
        ],
      ])
      .mockResolvedValueOnce([["t", "d"]])
      .mockResolvedValueOnce([["t", "p"]])
      .mockResolvedValueOnce([["t", "label"]])
      .mockResolvedValueOnce([["t", "Check"]]);
    await expect(repository.findAll()).resolves.toMatchObject([
      {
        id: "t",
        departmentIds: ["d"],
        projectIds: ["p"],
        labelIds: ["label"],
        checklist: ["Check"],
      },
    ]);
  });

  it("refuses unsupported stored content or scope", async () => {
    const { repository, query } = fixture();
    for (const row of [
      ["t", "Name", "u", "bad", "Title", "", "normal", "all", "c", "u"],
      ["t", "Name", "u", "task", "Title", "", "normal", "bad", "c", "u"],
    ]) {
      query
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      await expect(repository.findAll()).rejects.toThrow();
    }
  });

  it("deduplicates linked IDs when saving a complete template", async () => {
    const { repository, execute } = fixture();
    await repository.save({
      id: "t",
      name: "Template",
      ownerId: "u",
      type: "task",
      title: "Title",
      description: "",
      priority: "normal",
      scope: "all",
      departmentIds: ["d", "d"],
      projectIds: [],
      labelIds: ["l"],
      checklist: ["one", "two"],
    });
    expect(execute).toHaveBeenCalledTimes(9);
  });
});
