import { describe, expect, it } from "vitest";

import { ProjectLifecycleRepository } from "@/backend/database/repositories/project/ProjectLifecycleRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";

import { useMigratedDatabase } from "../helpers/test-database";

import type { Database } from "@/backend/database/Database";

let sequence = 0;

async function insertItem(
  database: Database,
  item: {
    readonly id: string;
    readonly type: string;
    readonly projectId?: string;
    readonly parentId?: string | null;
    readonly milestoneId?: string | null;
    readonly isArchived?: boolean;
  },
): Promise<void> {
  sequence += 1;
  await database.execute(
    `
      INSERT INTO work_items (
          id, project_id, key, number, type, parent_id, title,
          status_id, created_by, milestone_id, archived_at
      )
      VALUES (
          $id, $project_id, $key, $number, $type, $parent_id, $title,
          'status-todo', 'user-1', $milestone_id,
          CASE WHEN $is_archived THEN utc_now() ELSE NULL END
      );
    `,
    {
      id: item.id,
      is_archived: item.isArchived ?? false,
      key: `K-${sequence}`,
      milestone_id: item.milestoneId ?? null,
      number: sequence,
      parent_id: item.parentId ?? null,
      project_id: item.projectId ?? "project-1",
      title: item.id,
      type: item.type,
    },
  );
}

async function insertMilestone(
  repository: TaskRepository,
  id: string,
  projectId = "project-1",
): Promise<void> {
  await repository.insertMilestone({
    description: "",
    dueAt: null,
    id,
    name: id,
    projectId,
  });
}

describe("milestone and initiative links on DuckDB", () => {
  const getDatabase = useMigratedDatabase();

  it("reads the table rows and the own milestone of initiatives as one relation", async () => {
    const database = getDatabase();
    const repository = new TaskRepository(database);
    await insertMilestone(repository, "m-1");
    await insertMilestone(repository, "m-2");
    await insertMilestone(repository, "m-other", "project-2");
    await insertMilestone(repository, "m-gone");
    await insertItem(database, {
      id: "own",
      type: "initiative",
      milestoneId: "m-1",
    });
    await insertItem(database, {
      id: "both",
      type: "initiative",
      milestoneId: "m-1",
    });
    await insertItem(database, {
      id: "epic",
      type: "epic",
      milestoneId: "m-1",
    });
    await insertItem(database, {
      id: "foreign",
      type: "initiative",
      projectId: "project-2",
    });

    await repository.linkInitiativeToMilestone("m-1", "both");
    await repository.linkInitiativeToMilestone("m-2", "both");
    await repository.linkInitiativeToMilestone("m-1", "both");
    await repository.linkInitiativeToMilestone("m-2", "epic");
    await repository.linkInitiativeToMilestone("m-other", "own");
    await repository.linkInitiativeToMilestone("m-gone", "own");
    await repository.archiveMilestone("m-gone");

    expect(await repository.findMilestoneInitiativeLinks([])).toEqual([]);
    expect(
      await repository.findMilestoneInitiativeLinks(["project-1"]),
    ).toEqual([
      { initiativeId: "both", milestoneId: "m-1" },
      { initiativeId: "own", milestoneId: "m-1" },
      { initiativeId: "both", milestoneId: "m-2" },
    ]);

    await repository.unlinkInitiativeFromMilestone("m-2", "both");
    expect(
      await repository.findMilestoneInitiativeLinks(["project-1"]),
    ).toHaveLength(2);
  });

  it("counts the active descendants of an initiative that carry the milestone", async () => {
    const database = getDatabase();
    const repository = new TaskRepository(database);
    await insertMilestone(repository, "m-1");
    await insertItem(database, { id: "initiative", type: "initiative" });
    await insertItem(database, {
      id: "epic",
      type: "epic",
      parentId: "initiative",
      milestoneId: "m-1",
    });
    await insertItem(database, { id: "task", type: "task", parentId: "epic" });
    await insertItem(database, {
      id: "subtask",
      type: "subtask",
      parentId: "task",
      milestoneId: "m-1",
    });
    await insertItem(database, {
      id: "archived",
      type: "task",
      parentId: "epic",
      milestoneId: "m-1",
      isArchived: true,
    });
    await insertItem(database, {
      id: "stranger",
      type: "task",
      milestoneId: "m-1",
    });

    expect(await repository.countMilestoneDependents("initiative", "m-1")).toBe(
      2,
    );
    expect(await repository.countMilestoneDependents("epic", "m-1")).toBe(1);
    expect(await repository.countMilestoneDependents("task", "m-1")).toBe(1);
    expect(await repository.countMilestoneDependents("subtask", "m-1")).toBe(0);
    expect(await repository.countMilestoneDependents("initiative", "m-2")).toBe(
      0,
    );
  });

  it("gives a milestone only to items without one and clears only the milestone it names", async () => {
    const database = getDatabase();
    const repository = new TaskRepository(database);
    await insertMilestone(repository, "m-1");
    await insertMilestone(repository, "m-2");
    await insertItem(database, { id: "empty", type: "epic" });
    await insertItem(database, {
      id: "taken",
      type: "epic",
      milestoneId: "m-1",
    });
    await insertItem(database, {
      id: "closed",
      type: "epic",
      isArchived: true,
    });

    expect(await repository.setMilestoneIfEmpty("empty", "m-2")).toBe(true);
    expect(await repository.setMilestoneIfEmpty("empty", "m-1")).toBe(false);
    expect(await repository.setMilestoneIfEmpty("taken", "m-2")).toBe(false);
    expect(await repository.setMilestoneIfEmpty("closed", "m-2")).toBe(false);

    const milestones = async () =>
      database.query(
        "SELECT id, milestone_id FROM work_items WHERE type = 'epic' ORDER BY id;",
      );

    await repository.clearMilestone("empty", "m-1");
    await repository.clearMilestone("taken", "m-2");
    expect(await milestones()).toEqual([
      ["closed", null],
      ["empty", "m-2"],
      ["taken", "m-1"],
    ]);
    await repository.clearMilestone("empty", "m-2");
    expect(await milestones()).toEqual([
      ["closed", null],
      ["empty", null],
      ["taken", "m-1"],
    ]);
  });

  it("removes the rows with a deleted initiative and with a deleted project", async () => {
    const database = getDatabase();
    const repository = new TaskRepository(database);
    await insertMilestone(repository, "m-1");
    await insertMilestone(repository, "m-2", "project-2");
    await insertItem(database, { id: "doomed", type: "initiative" });
    await insertItem(database, { id: "kept", type: "initiative" });
    await insertItem(database, {
      id: "foreign",
      type: "initiative",
      projectId: "project-2",
    });
    await repository.linkInitiativeToMilestone("m-1", "doomed");
    await repository.linkInitiativeToMilestone("m-1", "kept");
    await repository.linkInitiativeToMilestone("m-2", "foreign");

    const rows = async () =>
      database.query(
        "SELECT milestone_id, initiative_id FROM milestone_initiatives ORDER BY milestone_id, initiative_id;",
      );
    await new TaskRepository(database).deleteSubtree("doomed");
    expect(await rows()).toEqual([
      ["m-1", "kept"],
      ["m-2", "foreign"],
    ]);

    await database.transaction((transaction) =>
      new ProjectLifecycleRepository(transaction).delete("project-1"),
    );
    expect(await rows()).toEqual([["m-2", "foreign"]]);
  });
});
