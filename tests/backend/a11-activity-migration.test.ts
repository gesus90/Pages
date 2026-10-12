import { expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { ProjectActivityRepository } from "@/backend/database/repositories/project/ProjectActivityRepository";

it("preserves existing project activity and its visibility reference when introducing wiki and sources", async () => {
  const database = await Database.create(IN_MEMORY_DATABASE_PATH);
  try {
    await database.migrate(
      DATABASE_MIGRATIONS.filter(({ name }) => name < "034_"),
    );
    await database.execute(`
      INSERT INTO project_activity (
          id, project_id, user_id, category, action, message, created_at, work_item_id
      )
      VALUES (
          'legacy', 'project', 'owner', 'tasks', 'changed', 'Retained', '2026-10-10 08:00:00', 'ticket'
      );
    `);
    await database.migrate(DATABASE_MIGRATIONS);
    await new ProjectActivityRepository(database, "mcp").insert({
      id: "wiki",
      projectId: "project",
      userId: "owner",
      category: "wiki",
      action: "wiki_page_created",
      message: "Created",
      wikiPageId: "page",
    });
    await database.migrate(DATABASE_MIGRATIONS);
    expect(
      await database.query(`
      SELECT id, category, source, work_item_id, wiki_page_id, created_at
      FROM project_activity
      ORDER BY id;
    `),
    ).toEqual([
      ["legacy", "tasks", "ui", "ticket", null, "2026-10-10 08:00:00"],
      ["wiki", "wiki", "mcp", null, "page", expect.any(String)],
    ]);
    expect(
      await database.query(`
      SELECT index_name
      FROM duckdb_indexes()
      WHERE table_name = 'project_activity';
    `),
    ).toEqual([["project_activity_work_item_id"]]);
  } finally {
    await database.close();
  }
});
