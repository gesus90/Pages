import { describe, expect, it, vi } from "vitest";

import { WorkItemTemplateRepository } from "./WorkItemTemplateRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { NewWorkItemTemplate } from "./WorkItemTemplateRepository";

function templateRow(
  id: string,
  overrides: Readonly<Record<number, DatabaseValue>> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    id,
    `Name ${id}`,
    "owner",
    "task",
    "Title",
    "Desc",
    "low",
    "all",
    "c",
    "u",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

/** Answers the template query first, then departments, projects, labels, checklist. */
function databaseOf(...results: DatabaseValue[][][]): {
  readonly repository: WorkItemTemplateRepository;
  readonly query: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => [] as DatabaseValue[][]);
  for (const rows of results) query.mockResolvedValueOnce(rows);
  const execute = vi.fn(async () => {});
  const database = {
    query,
    transaction: async (work: (scope: unknown) => Promise<unknown>) =>
      work({ execute }),
  } as unknown as Database;
  return {
    repository: new WorkItemTemplateRepository(database),
    query,
    execute,
  };
}

describe("WorkItemTemplateRepository reads", () => {
  it("maps templates with their parts", async () => {
    const { repository } = databaseOf(
      [templateRow("t1"), templateRow("t2")],
      [
        ["t1", "d1"],
        ["t1", "d2"],
      ],
      [["t1", "p1"]],
      [["t2", "l1"]],
      [["t2", "step"]],
    );

    const [first, second] = await repository.findAll();

    expect(first).toMatchObject({
      id: "t1",
      departmentIds: ["d1", "d2"],
      projectIds: ["p1"],
      labelIds: [],
      checklist: [],
    });
    expect(second).toMatchObject({
      labelIds: ["l1"],
      checklist: ["step"],
      departmentIds: [],
    });
  });

  it("finds a template by identifier", async () => {
    const { repository } = databaseOf([templateRow("t1")], [], [], [], []);

    await expect(repository.findById("t1")).resolves.toMatchObject({
      id: "t1",
    });
  });

  it("returns null for an unknown identifier", async () => {
    const { repository } = databaseOf([templateRow("t1")], [], [], [], []);

    await expect(repository.findById("nope")).resolves.toBeNull();
  });

  it.each([[{ 3: "bug" }], [{ 6: "meh" }]])(
    "rejects unsupported content %j",
    async (override) => {
      const { repository } = databaseOf(
        [templateRow("t1", override)],
        [],
        [],
        [],
        [],
      );

      await expect(repository.findAll()).rejects.toThrow(
        "unsupported template content",
      );
    },
  );

  it("rejects an unsupported scope", async () => {
    const { repository } = databaseOf(
      [templateRow("t1", { 7: "world" })],
      [],
      [],
      [],
      [],
    );

    await expect(repository.findAll()).rejects.toThrow(
      "unsupported template scope",
    );
  });
});

describe("WorkItemTemplateRepository writes", () => {
  const TEMPLATE: NewWorkItemTemplate = {
    id: "t1",
    name: "N",
    ownerId: "o",
    type: "task",
    title: "T",
    description: "D",
    priority: "low",
    scope: "all",
    departmentIds: ["d", "d"],
    projectIds: ["p"],
    labelIds: ["l"],
    checklist: ["one", "two"],
  };

  it("replaces the template and its parts", async () => {
    const { repository, execute } = databaseOf();

    await repository.save(TEMPLATE);

    const statements = execute.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toContain("INSERT INTO work_item_templates");
    expect(statements.filter((s) => s.startsWith("DELETE FROM"))).toHaveLength(
      4,
    );
    expect(
      statements.filter((s) =>
        s.includes("INSERT INTO work_item_template_departments"),
      ),
    ).toHaveLength(1);
    expect(execute).toHaveBeenLastCalledWith(expect.any(String), {
      id: "t1",
      position: 1,
      title: "two",
    });
  });

  it("deletes a template with its parts", async () => {
    const { repository, execute } = databaseOf();

    await repository.delete("t1");

    expect(execute).toHaveBeenCalledTimes(5);
    expect(execute).toHaveBeenLastCalledWith(
      "DELETE FROM work_item_templates WHERE id = $id;",
      { id: "t1" },
    );
  });
});
