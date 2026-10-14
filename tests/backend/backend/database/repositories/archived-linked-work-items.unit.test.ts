import { expect, it, vi } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { TaskDatabase } from "@/backend/database/repositories/task/TaskDatabase";

function boundary(): TaskDatabase {
  const connection: DatabaseTransaction = {
    query: vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]),
    execute: vi.fn<DatabaseTransaction["execute"]>().mockResolvedValue(),
  };
  return { ...connection, transaction: async (work) => work(connection) };
}

it("reads archived tasks of one project that are linked to an issue", async () => {
  const database = boundary();
  const repository = new TaskRepository(database);

  await expect(
    repository.findArchivedLinkedWorkItems("pages"),
  ).resolves.toEqual([]);

  const [statement, parameters] = vi.mocked(database.query).mock.calls[0] ?? [];
  expect(statement).toContain("work_items.project_id = $project_id");
  expect(statement).toContain("work_items.type = $type");
  expect(statement).toContain("work_items.github_issue_number IS NOT NULL");
  expect(statement).toContain("work_items.archived_at IS NOT NULL");
  expect(parameters).toEqual({ project_id: "pages", type: "task" });
  expect(database.execute).not.toHaveBeenCalled();
});

it("keeps the ticket scope of the actor when it reads archived linked tasks", async () => {
  const database = boundary();
  const repository = new TaskRepository(database);

  await repository.findArchivedLinkedWorkItems("pages", {
    departmentIds: ["engineering"],
  });

  const [statement, parameters] = vi.mocked(database.query).mock.calls[0] ?? [];
  expect(statement).toContain("work_items.department_id IN (");
  expect(parameters).toMatchObject({
    project_id: "pages",
    type: "task",
    visible_department_id_0: "engineering",
  });
});
