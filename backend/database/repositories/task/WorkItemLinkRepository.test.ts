import { describe, expect, it, vi } from "vitest";

import { WorkItemLinkRepository } from "./WorkItemLinkRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function databaseOf(rows: DatabaseValue[][]): {
  readonly database: TaskDatabase;
  readonly query: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => {});
  return {
    database: { query, execute } as unknown as TaskDatabase,
    query,
    execute,
  };
}

function linkRow(linkType = "blocks", direction = "outgoing"): DatabaseValue[] {
  return ["l1", linkType, direction, "w2", "K-2", "Other", "todo", 1, "now"];
}

describe("WorkItemLinkRepository.findByWorkItemId", () => {
  it("maps the links of both directions", async () => {
    const { database, query } = databaseOf([
      linkRow(),
      linkRow("relates_to", "incoming"),
    ]);

    const links = await new WorkItemLinkRepository(database).findByWorkItemId(
      "w1",
      {
        departmentIds: null,
      },
    );

    expect(links[0]).toEqual({
      createdAt: "now",
      direction: "outgoing",
      id: "l1",
      linkType: "blocks",
      linkedWorkItemId: "w2",
      linkedWorkItemIsDone: true,
      linkedWorkItemKey: "K-2",
      linkedWorkItemStatusKey: "todo",
      linkedWorkItemTitle: "Other",
    });
    expect(links[1]?.direction).toBe("incoming");
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      work_item_id: "w1",
    });
  });

  it("rejects an unsupported link type", async () => {
    const { database } = databaseOf([linkRow("odd")]);

    await expect(
      new WorkItemLinkRepository(database).findByWorkItemId("w1"),
    ).rejects.toThrow('unsupported link type "odd"');
  });

  it("rejects an unsupported direction", async () => {
    const { database } = databaseOf([linkRow("blocks", "sideways")]);

    await expect(
      new WorkItemLinkRepository(database).findByWorkItemId("w1"),
    ).rejects.toThrow('unsupported link direction "sideways"');
  });
});

describe("WorkItemLinkRepository", () => {
  it("finds a stored link", async () => {
    const { database } = databaseOf([["l1", "w1", "w2", "duplicates"]]);

    await expect(
      new WorkItemLinkRepository(database).findById("l1"),
    ).resolves.toEqual({
      id: "l1",
      linkType: "duplicates",
      linkedWorkItemId: "w2",
      workItemId: "w1",
    });
  });

  it("returns null for an unknown link", async () => {
    const { database } = databaseOf([]);

    await expect(
      new WorkItemLinkRepository(database).findById("x"),
    ).resolves.toBeNull();
  });

  it("inserts a link", async () => {
    const { database, execute } = databaseOf([]);

    await new WorkItemLinkRepository(database).insert({
      id: "l",
      workItemId: "w1",
      linkedWorkItemId: "w2",
      linkType: "blocks",
    });

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO work_item_links"),
      {
        id: "l",
        link_type: "blocks",
        linked_work_item_id: "w2",
        work_item_id: "w1",
      },
    );
  });

  it("deletes a link", async () => {
    const { database, execute } = databaseOf([]);

    await new WorkItemLinkRepository(database).delete("l");

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM"),
      { id: "l" },
    );
  });
});
