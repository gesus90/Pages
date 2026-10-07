import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Database } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { transferSqliteToDuckDb } from "@/backend/database/legacy/SqliteTransfer";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { ProjectLifecycleRepository } from "@/backend/database/repositories/project/ProjectLifecycleRepository";
import {
  createLegacyDatabase,
  fillLegacyDatabase,
  listLegacyMigrationNames,
} from "../helpers/legacy-sqlite";

const OWNED_TABLES = [
  "project_departments",
  "project_members",
  "project_icons",
  "project_keys",
  "project_goals",
  "project_tags",
  "project_events",
  "project_activity",
  "project_integrations",
  "github_external_issues",
  "github_pull_requests",
  "milestone_dependencies",
  "milestones",
  "tasks",
  "wiki_pages",
  "work_items",
] as const;

const CHILD_TABLES = [
  "work_item_history",
  "work_item_checklist_items",
  "work_item_links",
  "work_item_labels",
] as const;

describe("project archive and permanent deletion persistence", () => {
  let directory: string;
  let database: Database;
  let repository: ProjectRepository;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-project-lifecycle-"));
    const sourcePath = path.join(directory, "legacy.db");
    const targetPath = path.join(directory, "pages.duckdb");
    const legacy = createLegacyDatabase(sourcePath);
    fillLegacyDatabase(legacy);
    legacy.close();
    await transferSqliteToDuckDb({
      sourcePath,
      targetPath,
      migrations: DATABASE_MIGRATIONS,
      legacyMigrationNames: listLegacyMigrationNames(),
    });
    database = await Database.create(targetPath);
    repository = new ProjectRepository(database);
    await repository
      .authorization()
      .saveDepartment({ id: "frontend", name: "Frontend" });
    await repository.setDepartments("p1", ["frontend"]);
    await database.execute(`
      INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by)
      VALUES ('foreign', 'p2', 'TOOL-1', 1, 'task', 'Foreign ticket', 'status-todo', 'u1');
    `);
    await database.execute(`
      INSERT INTO work_item_links (id, work_item_id, linked_work_item_id, link_type)
      VALUES ('incoming', 'foreign', 'w1', 'blocks'), ('outgoing', 'w2', 'foreign', 'relates_to');
    `);
    await database.execute(`
      INSERT INTO workflow_statuses (id, project_id, key, name, position)
      VALUES ('project-status', 'p1', 'local', 'Local status', 10);
    `);
  });

  afterEach(async () => {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps archived records, their metadata and departments outside active lists", async () => {
    expect((await repository.findAll()).map((project) => project.id)).toEqual([
      "p1",
    ]);
    expect(await repository.findArchivedById("p1")).toBeNull();
    expect(await repository.findArchivedById("p2")).toMatchObject({
      id: "p2",
      archivedAt: "2026-02-01 00:00:00",
      departments: [],
    });
    await repository.archive("p1");
    expect(await repository.findById("p1")).toBeNull();
    expect(await repository.findAll()).toEqual([]);
    const archives = await repository.findArchived();
    expect(archives.map((project) => project.id)).toEqual(["p1", "p2"]);
    expect(archives[0]).toMatchObject({
      id: "p1",
      departments: [{ id: "frontend", name: "Frontend" }],
    });
    expect(archives[0]?.archivedAt).toEqual(expect.any(String));
    expect(
      await database.query(
        "SELECT COUNT(*) FROM work_items WHERE project_id = 'p1';",
      ),
    ).toEqual([[2]]);
  });

  it.each([false, true])(
    "deletes the complete aggregate and incoming/outgoing links, archived=%s",
    async (archived) => {
      if (archived) await repository.archive("p1");
      await repository.deletePermanently("p1");
      expect(await repository.findById("p1")).toBeNull();
      expect(await repository.findArchivedById("p1")).toBeNull();
      expect(await repository.findArchivedById("p2")).toMatchObject({
        id: "p2",
        parentId: null,
      });
      for (const table of OWNED_TABLES) {
        expect(
          await database.query(
            `SELECT COUNT(*) FROM ${table} WHERE project_id = 'p1';`,
          ),
          table,
        ).toEqual([[0]]);
      }
      for (const table of CHILD_TABLES) {
        expect(
          await database.query(`SELECT COUNT(*) FROM ${table};`),
          table,
        ).toEqual([[0]]);
      }
      expect(await database.query("SELECT id FROM work_items;")).toEqual([
        ["foreign"],
      ]);
      expect(
        await database.query("SELECT COUNT(*) FROM workflow_statuses;"),
      ).toEqual([[5]]);
      expect(await database.query("SELECT COUNT(*) FROM users;")).toEqual([
        [2],
      ]);
      expect(await database.query("SELECT COUNT(*) FROM departments;")).toEqual(
        [[1]],
      );
      await repository.deletePermanently("p2");
      await repository.deletePermanently("missing");
      expect(await repository.findArchived()).toEqual([]);
    },
  );

  it("rolls back every deletion and parent update when persistence fails before commit", async () => {
    const remove = ProjectLifecycleRepository.prototype.delete;
    vi.spyOn(
      ProjectLifecycleRepository.prototype,
      "delete",
    ).mockImplementationOnce(async function (
      this: ProjectLifecycleRepository,
      id,
    ) {
      await remove.call(this, id);
      throw new Error("Delete failed");
    });
    await expect(repository.deletePermanently("p1")).rejects.toThrow(
      "Delete failed",
    );
    expect(await repository.findById("p1")).toMatchObject({
      id: "p1",
      departments: [{ id: "frontend", name: "Frontend" }],
    });
    expect(await repository.findArchivedById("p2")).toMatchObject({
      parentId: "p1",
    });
    for (const table of OWNED_TABLES) {
      expect(
        (
          await database.query(
            `SELECT COUNT(*) FROM ${table} WHERE project_id = 'p1';`,
          )
        )[0]?.[0],
        table,
      ).toBeGreaterThan(0);
    }
    expect(
      await database.query("SELECT COUNT(*) FROM work_item_links;"),
    ).toEqual([[3]]);
    expect(
      await database.query("SELECT COUNT(*) FROM work_item_history;"),
    ).toEqual([[2]]);
    expect(
      await database.query("SELECT COUNT(*) FROM work_item_checklist_items;"),
    ).toEqual([[1]]);
    expect(
      await database.query("SELECT COUNT(*) FROM work_item_labels;"),
    ).toEqual([[1]]);
  });
});
