import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";

import type { WorkItemVisibility } from "@/definition/Task";

const FRONTEND_VISIBILITY: WorkItemVisibility = {
  departmentIds: ["frontend"],
  projectIds: ["p1"],
};

describe("ticket department visibility persistence", () => {
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
      VALUES ('p1', 'Shared project', 'actor'), ('p2', 'Other project', 'actor');
      INSERT INTO work_items (
          id, project_id, key, number, type, parent_id, title, status_id,
          created_by, department_id, sort_order
      ) VALUES
          ('root', 'p1', 'PAGE-1', 1, 'epic', NULL, 'Public root', 'status-todo', 'actor', NULL, 1),
          ('hidden', 'p1', 'PAGE-2', 2, 'epic', NULL, 'Backend parent', 'status-todo', 'actor', 'backend', 0),
          ('public-child', 'p1', 'PAGE-3', 3, 'subtask', 'hidden', 'Public child', 'status-todo', 'actor', NULL, 2),
          ('front-child', 'p1', 'PAGE-4', 4, 'subtask', 'root', 'Frontend child', 'status-done', 'actor', 'frontend', 3),
          ('back-child', 'p1', 'PAGE-5', 5, 'subtask', 'root', 'Backend child', 'status-todo', 'actor', 'backend', 4),
          ('foreign', 'p2', 'OTHER-1', 1, 'task', NULL, 'Other public ticket', 'status-todo', 'actor', NULL, -1);
      INSERT INTO work_item_history (id, work_item_id, user_id, action)
      VALUES ('root-history', 'root', 'actor', 'created'),
          ('front-history', 'front-child', 'actor', 'created'),
          ('back-history', 'back-child', 'actor', 'created');
      INSERT INTO project_labels (id, project_id, name, color)
      VALUES ('label', 'p1', 'Shared label', '#3b82f6');
      INSERT INTO work_item_labels (work_item_id, label_id)
      VALUES ('root', 'label'), ('front-child', 'label'), ('back-child', 'label');
      INSERT INTO work_item_links (id, work_item_id, linked_work_item_id, link_type)
      VALUES ('hidden-link', 'root', 'back-child', 'blocks'),
          ('incoming-link', 'front-child', 'root', 'relates_to'),
          ('foreign-link', 'root', 'foreign', 'relates_to'),
          ('public-link', 'root', 'public-child', 'relates_to');
      INSERT INTO github_pull_requests (id, project_id, number, title, url, state, work_item_id)
      VALUES ('unassigned-pr', 'p1', 1, 'Unassigned change', 'https://example.invalid/1', 'open', NULL),
          ('public-pr', 'p1', 2, 'Public change', 'https://example.invalid/2', 'open', 'root'),
          ('front-pr', 'p1', 3, 'Frontend change', 'https://example.invalid/3', 'open', 'front-child'),
          ('back-pr', 'p1', 4, 'Backend change', 'https://example.invalid/4', 'open', 'back-child'),
          ('foreign-pr', 'p1', 5, 'Other project change', 'https://example.invalid/5', 'open', 'foreign');
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  it("filters before limit and keeps public tickets alongside own departments", async () => {
    const items = await repository.findAll({ visibility: FRONTEND_VISIBILITY });
    expect(items.map((item) => item.id)).toEqual([
      "root",
      "public-child",
      "front-child",
    ]);
    expect(items[2]?.departmentId).toBe("frontend");
    const limited = await repository.findAll({
      visibility: FRONTEND_VISIBILITY,
      limit: 1,
    });
    expect(limited.map((item) => item.id)).toEqual(["root"]);
    expect(
      await repository.findAll({
        visibility: FRONTEND_VISIBILITY,
        search: "Backend",
      }),
    ).toEqual([]);
  });

  it("denies hidden identifiers and keys, and redacts foreign parent metadata", async () => {
    expect(await repository.findById("hidden", FRONTEND_VISIBILITY)).toBeNull();
    expect(
      await repository.findByKey("PAGE-2", FRONTEND_VISIBILITY),
    ).toBeNull();
    expect(
      await repository.findById("public-child", FRONTEND_VISIBILITY),
    ).toMatchObject({ parentId: null, parentKey: null, parentTitle: null });
    expect(
      await repository.findByKey("PAGE-4", FRONTEND_VISIBILITY),
    ).toMatchObject({ parentId: "root", parentTitle: "Public root" });
    expect(await repository.findById("public-child")).toMatchObject({
      parentId: "hidden",
      parentKey: "PAGE-2",
      parentTitle: "Backend parent",
    });
  });

  it("restricts subtask lists and progress counters to visible children", async () => {
    expect(
      (await repository.findSubtasks("root", FRONTEND_VISIBILITY)).map(
        (item) => item.id,
      ),
    ).toEqual(["front-child"]);
    expect(
      await repository.findById("root", FRONTEND_VISIBILITY),
    ).toMatchObject({
      subtaskTotal: 1,
      subtaskCompleted: 1,
      progressPercentage: 100,
    });
    expect(
      await repository.findById("root", { departmentIds: ["backend"] }),
    ).toMatchObject({ subtaskTotal: 1, subtaskCompleted: 0 });
  });

  it("supports public-only, unrestricted and empty project scopes", async () => {
    expect(
      (await repository.findAll({ visibility: { departmentIds: [] } })).map(
        (item) => item.id,
      ),
    ).toEqual(["foreign", "root", "public-child"]);
    expect(
      await repository.findAll({ visibility: { departmentIds: null } }),
    ).toHaveLength(6);
    expect(
      await repository.findAll({
        visibility: { departmentIds: null, projectIds: [] },
      }),
    ).toEqual([]);
    expect(
      await repository.findById("root", {
        departmentIds: null,
        projectIds: ["p1"],
      }),
    ).toMatchObject({ subtaskTotal: 2 });
  });

  it("filters project history, aggregate counters and label usage", async () => {
    expect(
      (await repository.findHistoryByProjectId("p1", FRONTEND_VISIBILITY)).map(
        (entry) => entry.id,
      ),
    ).toEqual(expect.arrayContaining(["root-history", "front-history"]));
    expect(
      await repository.findHistoryByProjectId("p1", FRONTEND_VISIBILITY),
    ).toHaveLength(2);
    expect(
      (
        await repository.countWorkItemsByProject(["p1"], FRONTEND_VISIBILITY)
      ).get("p1"),
    ).toEqual({ done: 1, total: 3 });
    expect(
      await repository.countWorkItemsOverview(
        ["p1"],
        {
          userId: "actor",
          todayDate: "2026-10-06",
          yesterdayDate: "2026-10-05",
          weekAgoStart: "2026-09-29 00:00:00",
        },
        FRONTEND_VISIBILITY,
      ),
    ).toMatchObject({ open: 2 });
    expect(await repository.countLabelUsage("label", FRONTEND_VISIBILITY)).toBe(
      2,
    );
    expect(
      (
        await repository.countLabelUsageByProjectIds(
          ["p1"],
          FRONTEND_VISIBILITY,
        )
      )
        .get("p1")
        ?.get("label"),
    ).toBe(2);
  });

  it("omits hidden incoming/outgoing links and inaccessible project references", async () => {
    expect(
      (await repository.findLinksByWorkItemId("root", FRONTEND_VISIBILITY)).map(
        (link) => link.id,
      ),
    ).toEqual(expect.arrayContaining(["incoming-link", "public-link"]));
    expect(
      await repository.findLinksByWorkItemId("root", FRONTEND_VISIBILITY),
    ).toHaveLength(2);
    expect(await repository.findLinksByWorkItemId("root")).toHaveLength(4);
  });

  it("applies department changes immediately and makes deleted assignments public", async () => {
    await database.execute(
      "UPDATE work_items SET department_id = 'frontend' WHERE id = 'hidden';",
    );
    expect(
      await repository.findById("hidden", FRONTEND_VISIBILITY),
    ).toMatchObject({ departmentId: "frontend" });
    await new AuthorizationRepository(database).deleteDepartment("frontend");
    expect(
      await repository.findById("hidden", { departmentIds: [] }),
    ).toMatchObject({ departmentId: null });
    expect(
      await repository.findById("front-child", { departmentIds: [] }),
    ).toMatchObject({ departmentId: null });
    expect(
      await repository.findById("back-child", { departmentIds: [] }),
    ).toBeNull();
  });

  it("filters GitHub ticket references from project, batch and individual PR reads", async () => {
    const github = new GitHubRepository(database);
    expect(
      (await github.findPullRequestsByProject("p1", FRONTEND_VISIBILITY)).map(
        (pullRequest) => pullRequest.id,
      ),
    ).toEqual(["front-pr", "public-pr", "unassigned-pr"]);
    expect(
      (
        await github.findPullRequestsByProjectIds(["p1"], FRONTEND_VISIBILITY)
      ).get("p1"),
    ).toHaveLength(3);
    expect(
      await github.findPullRequestsByWorkItem(
        "back-child",
        FRONTEND_VISIBILITY,
      ),
    ).toEqual([]);
    expect(
      await github.findPullRequestsByWorkItem(
        "front-child",
        FRONTEND_VISIBILITY,
      ),
    ).toHaveLength(1);
    expect(
      await github.findPullRequestById("back-pr", FRONTEND_VISIBILITY),
    ).toBeNull();
    expect(
      await github.findPullRequestById("front-pr", FRONTEND_VISIBILITY),
    ).toMatchObject({ workItemId: "front-child", workItemKey: "PAGE-4" });
    expect(await github.findPullRequestsByProject("p1")).toHaveLength(5);
  });

  it("limits internally linked ticket queries to the same department scope", async () => {
    await database.execute(`
      UPDATE work_items SET github_issue_number = number WHERE project_id = 'p1';
    `);
    expect(
      (await repository.findLinkedWorkItems("p1", FRONTEND_VISIBILITY)).map(
        (item) => item.id,
      ),
    ).toEqual(["root", "public-child", "front-child"]);
  });
});
