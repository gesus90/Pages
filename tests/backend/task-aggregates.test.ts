import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Database } from "@/backend/database/Database";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";

let directory = "";
let database: Database | null = null;

async function seed(): Promise<void> {
  const db = database as Database;

  await db.execute(
    "INSERT INTO users (id, username, display_name, password_hash, role) VALUES ('u-admin', 'admin', 'Admin', 'hash', 'admin'), ('u-member', 'member', 'Mitglied', 'hash', 'employee'), ('u-out', 'outsider', 'Aussen', 'hash', 'employee');",
  );
  await db.execute(
    "INSERT INTO projects (id, name, owner_id, status, progress, placeholder_color) VALUES ('p1', 'Alpha', 'u-admin', 'active', 0, '#FCE3D3'), ('p2', 'Beta', 'u-admin', 'active', 0, '#FCE3D3');",
  );
  await db.execute(
    "INSERT INTO project_members (project_id, user_id, role) VALUES ('p1', 'u-member', 'member');",
  );
  await db.execute(
    "INSERT INTO milestones (id, project_id, name) VALUES ('m1', 'p1', 'M1');",
  );
  await db.execute(
    "INSERT INTO project_labels (id, project_id, name) VALUES ('l1', 'p1', 'Bug'), ('l2', 'p1', 'Feature'), ('l3', 'p2', 'Bug');",
  );

  const items = [
    "('w1', 'p1', 'T-1', 1, 'task', 'Offen 1', 'status-todo', 'u-admin', NULL, '2026-05-20', '2026-05-01 10:00:00', '2026-05-20 10:00:00', NULL)",
    "('w2', 'p1', 'T-2', 2, 'task', 'Erledigt', 'status-done', NULL, NULL, NULL, '2026-04-01 10:00:00', '2026-05-25 10:00:00', NULL)",
    "('w3', 'p1', 'T-3', 3, 'task', 'In Arbeit', 'status-in-progress', 'u-member', 'm1', '2026-06-01', '2026-05-28 10:00:00', '2026-05-29 10:00:00', NULL)",
    "('w4', 'p2', 'T-4', 1, 'task', 'Beta offen', 'status-todo', NULL, NULL, NULL, '2026-05-15 10:00:00', '2026-05-16 10:00:00', NULL)",
    "('w5', 'p1', 'T-5', 4, 'task', 'Archiviert', 'status-todo', NULL, NULL, '2026-04-01', '2026-05-20 10:00:00', '2026-05-21 10:00:00', '2026-05-22 10:00:00')",
  ];

  for (const values of items) {
    await db.execute(
      `INSERT INTO work_items (id, project_id, key, number, type, title, status_id, assignee_id, milestone_id, due_at, created_at, updated_at, archived_at, created_by) VALUES ${values.slice(0, -1)}, 'u-admin');`,
    );
  }

  await db.execute(
    "INSERT INTO work_item_labels (work_item_id, label_id) VALUES ('w1', 'l1'), ('w1', 'l2'), ('w3', 'l1'), ('w4', 'l3');",
  );
  await db.execute(
    "INSERT INTO project_integrations (project_id, repo_url, is_connected, repo_name, sync_interval_minutes) VALUES ('p1', 'https://github.com/acme/alpha', 1, 'acme/alpha', 0);",
  );
  await db.execute(
    "INSERT INTO github_external_issues (id, project_id, issue_number, title, url, dismissed) VALUES ('e1', 'p1', 7, 'Remote Fehler', 'https://example.invalid/7', 0), ('e2', 'p1', 9, 'Verworfen', 'https://example.invalid/9', 1), ('e3', 'p2', 3, 'Remote Wunsch', 'https://example.invalid/3', 0);",
  );
  await db.execute(
    "INSERT INTO github_pull_requests (id, project_id, number, title, url) VALUES ('pr1', 'p1', 42, 'Fix', 'https://example.invalid/pr/42');",
  );
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-aggregates-"));
  database = await Database.create(path.join(directory, "pages.db"));
  await database.migrate(
    path.join(process.cwd(), "backend", "database", "migrations"),
  );
  await seed();
});

afterEach(async () => {
  database?.close();
  database = null;

  if (directory) {
    await rm(directory, { force: true, recursive: true });
    directory = "";
  }
});

describe("task aggregates", () => {
  it("counts dashboard metrics with one query", async () => {
    const repository = new TaskRepository(database as Database);

    const overview = await repository.countWorkItemsOverview(["p1", "p2"], {
      todayDate: "2026-06-01",
      userId: "u-admin",
      weekAgoStart: "2026-05-25 00:00:00",
      yesterdayDate: "2026-05-31",
    });

    expect(overview).toEqual({
      assigned: 1,
      inProgress: 1,
      open: 3,
      openDelta: 1,
      overdue: 2,
      overdueDelta: 1,
    });
  });

  it("returns zeros for an empty project scope", async () => {
    const repository = new TaskRepository(database as Database);

    expect(
      await repository.countWorkItemsOverview([], {
        todayDate: "2026-06-01",
        userId: "u-admin",
        weekAgoStart: "2026-05-25 00:00:00",
        yesterdayDate: "2026-05-31",
      }),
    ).toEqual({
      assigned: 0,
      inProgress: 0,
      open: 0,
      openDelta: 0,
      overdue: 0,
      overdueDelta: 0,
    });
  });

  it("counts done and total items per project", async () => {
    const repository = new TaskRepository(database as Database);

    const counts = await repository.countWorkItemsByProject(["p1", "p2"]);

    expect(counts.get("p1")).toEqual({ done: 1, total: 3 });
    expect(counts.get("p2")).toEqual({ done: 0, total: 1 });
  });

  it("orders and limits work items without loading everything", async () => {
    const repository = new TaskRepository(database as Database);

    const recent = await repository.findAll({
      limit: 2,
      orderBy: "updated_desc",
    });
    expect(recent.map((item) => item.id)).toEqual(["w3", "w2"]);

    const nullsLast = await repository.findAll({
      limit: 3,
      orderBy: "due_nulls_last",
    });
    expect(nullsLast.map((item) => item.id)).toEqual(["w1", "w3", "w2"]);

    const openDated = await repository.findAll({
      hasDueDate: true,
      limit: 5,
      openOnly: true,
      orderBy: "due_asc",
    });
    expect(openDated.map((item) => item.id)).toEqual(["w1", "w3"]);
  });

  it("loads label catalogs for several projects at once", async () => {
    const repository = new TaskRepository(database as Database);

    const catalogs = await repository.findLabelsByProjectIds(["p1", "p2"]);

    expect(catalogs.get("p1")?.map((label) => label.name)).toEqual([
      "Bug",
      "Feature",
    ]);
    expect(catalogs.get("p2")?.map((label) => label.name)).toEqual(["Bug"]);
    expect(await repository.findLabelsByProjectIds([])).toEqual(new Map());
  });

  it("counts label usage for several projects at once", async () => {
    const repository = new TaskRepository(database as Database);

    const usage = await repository.countLabelUsageByProjectIds(["p1", "p2"]);

    expect(Object.fromEntries(usage.get("p1") ?? [])).toEqual({
      l1: 2,
      l2: 1,
    });
    expect(Object.fromEntries(usage.get("p2") ?? [])).toEqual({ l3: 1 });
  });

  it("resolves assignees for several projects at once", async () => {
    const repository = new TaskRepository(database as Database);

    const assignees = await repository.findEligibleAssigneesByProjectIds([
      "p1",
      "p2",
    ]);

    expect(assignees.get("p1")?.map((user) => user.id)).toEqual([
      "u-admin",
      "u-member",
    ]);
    expect(assignees.get("p2")?.map((user) => user.id)).toEqual(["u-admin"]);
  });

  it("loads integrations, issues, and pull requests per project", async () => {
    const databaseValue = database as Database;
    const projects = new ProjectRepository(databaseValue);
    const github = new GitHubRepository(databaseValue);

    const integrations = await projects.findIntegrationsByProjectIds([
      "p1",
      "p2",
    ]);
    expect(integrations.get("p1")?.repoName).toBe("acme/alpha");
    expect(integrations.has("p2")).toBe(false);

    const issues = await github.findExternalIssuesByProjectIds(["p1", "p2"]);
    expect(issues.get("p1")?.map((issue) => issue.issueNumber)).toEqual([7]);
    expect(issues.get("p2")?.map((issue) => issue.issueNumber)).toEqual([3]);

    const pullRequests = await github.findPullRequestsByProjectIds([
      "p1",
      "p2",
    ]);
    expect(pullRequests.get("p1")?.map((request) => request.number)).toEqual([
      42,
    ]);
    expect(pullRequests.has("p2")).toBe(false);
  });
});
