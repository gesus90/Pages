import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";

async function count(database: Database, table: string): Promise<number> {
  const rows = await database.query(`SELECT COUNT(*) FROM ${table};`);

  return Number(rows[0]?.[0]);
}

describe("work item lifecycle persistence", () => {
  let database: Database;
  let repository: TaskRepository;

  beforeEach(async () => {
    database = await Database.create(IN_MEMORY_DATABASE_PATH);
    await database.migrate(DATABASE_MIGRATIONS);
    repository = new TaskRepository(database);
    await database.execute(`
      INSERT INTO users (id, username, display_name, password_hash, role)
      VALUES ('actor', 'actor', 'Actor', 'hash', 'employee');
      INSERT INTO departments (id, name)
      VALUES ('frontend', 'Frontend'), ('backend', 'Backend');
      INSERT INTO projects (id, name, owner_id)
      VALUES ('p1', 'Shared project', 'actor');
      INSERT INTO work_items (
          id, project_id, key, number, type, parent_id, title, status_id,
          created_by, department_id, sort_order, archived_at
      ) VALUES
          ('epic', 'p1', 'PAGE-1', 1, 'epic', NULL, 'Epic', 'status-todo', 'actor', NULL, 1, NULL),
          ('task', 'p1', 'PAGE-2', 2, 'task', 'epic', 'Task', 'status-todo', 'actor', 'frontend', 2, NULL),
          ('hidden', 'p1', 'PAGE-3', 3, 'subtask', 'task', 'Hidden', 'status-todo', 'actor', 'backend', 3, NULL),
          ('sibling', 'p1', 'PAGE-4', 4, 'epic', NULL, 'Sibling', 'status-todo', 'actor', NULL, 4, NULL),
          ('done-child', 'p1', 'PAGE-5', 5, 'task', 'epic', 'Done child', 'status-done', 'actor', NULL, 5, '2026-01-01 00:00:00');
      INSERT INTO work_item_history (id, work_item_id, user_id, action)
      VALUES ('h1', 'task', 'actor', 'created'), ('h2', 'sibling', 'actor', 'created');
      INSERT INTO work_item_checklist_items (id, work_item_id, title)
      VALUES ('c1', 'hidden', 'Check'), ('c2', 'sibling', 'Check');
      INSERT INTO labels (id, name, color)
      VALUES ('label', 'Label', '#3b82f6');
      INSERT INTO work_item_labels (work_item_id, label_id)
      VALUES ('task', 'label'), ('sibling', 'label');
      INSERT INTO work_item_links (id, work_item_id, linked_work_item_id, link_type)
      VALUES ('out', 'task', 'sibling', 'blocks'),
          ('in', 'sibling', 'hidden', 'relates_to'),
          ('keep', 'sibling', 'epic', 'relates_to');
      INSERT INTO github_pull_requests (id, project_id, number, title, url, state, work_item_id)
      VALUES ('pr', 'p1', 1, 'Change', 'https://example.invalid/1', 'open', 'task'),
          ('other-pr', 'p1', 2, 'Other', 'https://example.invalid/2', 'open', 'sibling');
      INSERT INTO github_external_issues (id, project_id, issue_number, title, url, imported_work_item_id)
      VALUES ('issue', 'p1', 7, 'Issue', 'https://example.invalid/7', 'hidden');
      INSERT INTO project_activity (id, project_id, user_id, action, category, message, work_item_id)
      VALUES ('a1', 'p1', 'actor', 'github_conflict', 'integrations', 'Conflict', 'task'),
          ('a2', 'p1', 'actor', 'github_conflict', 'integrations', 'Conflict', 'sibling');
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  it("finds a subtree including archived descendants", async () => {
    await expect(repository.findSubtreeIds("epic")).resolves.toEqual([
      "done-child",
      "epic",
      "hidden",
      "task",
    ]);
    await expect(repository.findSubtreeIds("unknown")).resolves.toEqual([]);
  });

  it("limits the found subtree to the visible scope without cutting branches", async () => {
    await expect(
      repository.findSubtreeIds("epic", {
        departmentIds: ["frontend"],
        projectIds: ["p1"],
      }),
    ).resolves.toEqual(["done-child", "epic", "task"]);
  });

  it("archives and restores only items in the matching state", async () => {
    await repository.archiveMany(["epic", "task", "done-child"]);

    const archived = await database.query(
      "SELECT id FROM work_items WHERE archived_at IS NOT NULL ORDER BY id;",
    );
    expect(archived.map((row) => row[0])).toEqual([
      "done-child",
      "epic",
      "task",
    ]);

    await repository.restoreMany(["epic", "task", "done-child", "sibling"]);

    await expect(
      count(database, "work_items WHERE archived_at IS NULL"),
    ).resolves.toBe(5);
  });

  it("ignores empty id lists", async () => {
    await repository.archiveMany([]);
    await repository.restoreMany([]);

    await expect(
      count(database, "work_items WHERE archived_at IS NULL"),
    ).resolves.toBe(4);
  });

  it("sets and clears the department of a work item", async () => {
    await repository.setDepartment("sibling", "backend");
    await expect(repository.findById("sibling")).resolves.toMatchObject({
      departmentId: "backend",
    });

    await repository.setDepartment("sibling", null);
    await expect(repository.findById("sibling")).resolves.toMatchObject({
      departmentId: null,
    });
  });

  it("deletes a subtree with every dependent row and keeps the rest", async () => {
    const removed = await repository.deleteSubtree("task");

    expect(removed).toEqual(["hidden", "task"]);
    await expect(repository.findById("task")).resolves.toBeNull();
    await expect(repository.findById("hidden")).resolves.toBeNull();
    await expect(repository.findById("epic")).resolves.not.toBeNull();
    await expect(repository.findById("sibling")).resolves.not.toBeNull();
    await expect(count(database, "work_item_history")).resolves.toBe(1);
    await expect(count(database, "work_item_checklist_items")).resolves.toBe(1);
    await expect(count(database, "work_item_labels")).resolves.toBe(1);
    await expect(count(database, "work_item_links")).resolves.toBe(1);
    await expect(count(database, "project_activity")).resolves.toBe(1);

    const pullRequests = await database.query(
      "SELECT id, work_item_id FROM github_pull_requests ORDER BY id;",
    );
    expect(pullRequests).toEqual([
      ["other-pr", "sibling"],
      ["pr", null],
    ]);
    const issues = await database.query(
      "SELECT imported_work_item_id FROM github_external_issues;",
    );
    expect(issues).toEqual([[null]]);
  });

  it("reports nothing removed for an unknown work item", async () => {
    await expect(repository.deleteSubtree("unknown")).resolves.toEqual([]);
    await expect(count(database, "work_items")).resolves.toBe(5);
  });
});
