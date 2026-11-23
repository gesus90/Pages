import { describe, expect, it, vi } from "vitest";

import { WorkItemQueryRepository } from "./WorkItemQueryRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function detailRow(id = "w1"): DatabaseValue[] {
  const row: DatabaseValue[] = Array.from({ length: 44 }, () => null);
  const values: Record<number, DatabaseValue> = {
    0: id,
    1: "p",
    2: "K-1",
    3: 1,
    4: "task",
    6: "T",
    7: "D",
    8: "s",
    9: "low",
    11: "c",
    14: 0,
    15: "c",
    16: "u",
    19: "P",
    20: "todo",
    21: "To do",
    22: 0,
    27: 0,
    28: 0,
    34: 0,
    39: "[]",
  };
  for (const [index, value] of Object.entries(values))
    row[Number(index)] = value;
  return row;
}

function databaseOf(rows: DatabaseValue[][]): {
  readonly repository: WorkItemQueryRepository;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  return {
    repository: new WorkItemQueryRepository({
      query,
    } as unknown as TaskDatabase),
    query,
  };
}

describe("WorkItemQueryRepository.findAll", () => {
  it("returns an empty list without querying for an empty project list", async () => {
    const { repository, query } = databaseOf([]);

    await expect(repository.findAll({ projectIds: [] })).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("maps the matching items", async () => {
    const { repository, query } = databaseOf([detailRow()]);

    await expect(repository.findAll()).resolves.toHaveLength(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), {});
  });
});

describe("WorkItemQueryRepository single lookups", () => {
  it("finds an item by identifier", async () => {
    const { repository, query } = databaseOf([detailRow("a"), detailRow("b")]);

    await expect(repository.findById("a")).resolves.toMatchObject({ id: "a" });
    expect(query).toHaveBeenCalledWith(expect.any(String), { id: "a" });
  });

  it("returns null when nothing matches", async () => {
    const { repository } = databaseOf([]);

    await expect(repository.findById("a")).resolves.toBeNull();
  });

  it("finds an item by key within the visibility", async () => {
    const { repository, query } = databaseOf([detailRow()]);

    await expect(
      repository.findByKey("K-1", { departmentIds: ["d"] }),
    ).resolves.not.toBeNull();
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      key: "K-1",
      visible_department_id_0: "d",
    });
  });
});

describe("WorkItemQueryRepository.findParentReference", () => {
  it("returns the stored parent", async () => {
    const { repository } = databaseOf([["p1", "K-0"]]);

    await expect(repository.findParentReference("w")).resolves.toEqual({
      id: "p1",
      key: "K-0",
    });
  });

  it("returns a parent without key", async () => {
    const { repository } = databaseOf([["p1", null]]);

    await expect(repository.findParentReference("w")).resolves.toEqual({
      id: "p1",
      key: null,
    });
  });

  it("returns null without parent", async () => {
    const { repository } = databaseOf([]);

    await expect(repository.findParentReference("w")).resolves.toBeNull();
  });
});

describe("WorkItemQueryRepository.findVisibleKeys", () => {
  it("skips the query without keys", async () => {
    const { repository, query } = databaseOf([]);

    await expect(
      repository.findVisibleKeys([], { departmentIds: null }),
    ).resolves.toEqual(new Set());
    expect(query).not.toHaveBeenCalled();
  });

  it("returns the visible keys", async () => {
    const { repository, query } = databaseOf([["K-1"]]);

    await expect(
      repository.findVisibleKeys(["K-1", "K-2"], { departmentIds: ["d"] }),
    ).resolves.toEqual(new Set(["K-1"]));
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      history_key_0: "K-1",
      history_key_1: "K-2",
      visible_department_id_0: "d",
    });
  });
});

describe("WorkItemQueryRepository condition lookups", () => {
  it("finds subtasks", async () => {
    const { repository, query } = databaseOf([detailRow()]);

    await expect(repository.findSubtasks("p")).resolves.toHaveLength(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), { parent_id: "p" });
  });

  it("finds linked items", async () => {
    const { repository, query } = databaseOf([detailRow()]);

    await expect(repository.findLinkedWorkItems("p")).resolves.toHaveLength(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), { project_id: "p" });
  });

  it("finds archived linked tasks", async () => {
    const { repository, query } = databaseOf([detailRow()]);

    await expect(
      repository.findArchivedLinkedWorkItems("p"),
    ).resolves.toHaveLength(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      project_id: "p",
      type: "task",
    });
  });

  it("collects the known GitHub issue numbers", async () => {
    const { repository } = databaseOf([[1], [5]]);

    await expect(repository.findKnownGitHubIssueNumbers("p")).resolves.toEqual(
      new Set([1, 5]),
    );
  });
});
