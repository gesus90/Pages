import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";

const BEFORE_GLOBAL_LABELS = DATABASE_MIGRATIONS.filter(
  (migration) => migration.name < "013_global_labels.sql",
);

describe("migration 013 global labels", () => {
  let database: Database;

  beforeEach(async () => {
    database = await Database.create(IN_MEMORY_DATABASE_PATH);
    await database.migrate(BEFORE_GLOBAL_LABELS);
  });

  afterEach(async () => {
    await database.close();
  });

  async function insertProjectLabel(
    id: string,
    projectId: string,
    name: string,
    createdAt: string,
    color: string,
  ): Promise<void> {
    await database.execute(
      `
        INSERT INTO project_labels (id, project_id, name, color, created_at)
        VALUES ($id, $project_id, $name, $color, $created_at);
      `,
      {
        color,
        created_at: createdAt,
        id,
        name,
        project_id: projectId,
      },
    );
  }

  async function assign(
    workItemId: string,
    labelId: string,
    assignedAt: string,
  ): Promise<void> {
    await database.execute(
      `
        INSERT INTO work_item_labels (work_item_id, label_id, assigned_at)
        VALUES ($work_item_id, $label_id, $assigned_at);
      `,
      { assigned_at: assignedAt, label_id: labelId, work_item_id: workItemId },
    );
  }

  it("merges labels of the same name into the oldest one", async () => {
    await insertProjectLabel("new-bug", "p2", "BUG", "2026-02-01", "#111111");
    await insertProjectLabel("old-bug", "p1", "Bug", "2026-01-01", "#ef4444");
    await insertProjectLabel("feature", "p1", "Feature", "2026-03-01", "#222");
    await assign("w1", "old-bug", "2026-04-02");
    await assign("w1", "new-bug", "2026-04-01");
    await assign("w2", "new-bug", "2026-04-03");
    await assign("w3", "feature", "2026-04-04");
    await assign("w4", "missing-label", "2026-04-05");

    await database.migrate(DATABASE_MIGRATIONS);

    expect(
      await database.query(
        "SELECT id, name, color FROM labels ORDER BY name ASC;",
      ),
    ).toEqual([
      ["old-bug", "Bug", "#ef4444"],
      ["feature", "Feature", "#222"],
    ]);
    expect(
      await database.query(`
        SELECT work_item_id, label_id, assigned_at
        FROM work_item_labels
        ORDER BY work_item_id ASC;
      `),
    ).toEqual([
      ["w1", "old-bug", "2026-04-01"],
      ["w2", "old-bug", "2026-04-03"],
      ["w3", "feature", "2026-04-04"],
    ]);
  });

  it("drops the project labels and keeps names unique ignoring case", async () => {
    await database.migrate(DATABASE_MIGRATIONS);

    const tables = await database.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main';",
    );
    const names = tables.map((row) => row[0]);

    expect(names).toContain("labels");
    expect(names).not.toContain("project_labels");
    expect(names).not.toContain("label_merge");

    await database.execute(
      "INSERT INTO labels (id, name) VALUES ('a', 'Bug');",
    );
    await expect(
      database.execute("INSERT INTO labels (id, name) VALUES ('b', 'bUG');"),
    ).rejects.toThrow();
  });
});
