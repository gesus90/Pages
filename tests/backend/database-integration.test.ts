import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { Database } from "@/backend/database/Database";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { ROLE } from "@/definition/Role";
import { LANGUAGE } from "@/language/Language";

describe("SQLite persistence", () => {
  let directory = "";
  let database: Database | null = null;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-sqlite-"));
    database = await Database.create(path.join(directory, "pages.db"));
    await database.migrate(
      path.join(process.cwd(), "backend", "database", "migrations"),
    );
  });

  afterEach(async () => {
    database?.close();
    database = null;

    if (directory) {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("applies the initial schema with every expected table", async () => {
    const rows = await database?.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    );

    expect(rows?.map((row) => row[0]).sort()).toEqual([
      "github_external_issues",
      "github_pull_requests",
      "milestones",
      "project_activity",
      "project_events",
      "project_goals",
      "project_icons",
      "project_integrations",
      "project_keys",
      "project_labels",
      "project_members",
      "project_tags",
      "projects",
      "schema_migrations",
      "sessions",
      "tasks",
      "user_settings",
      "users",
      "wiki_pages",
      "work_item_checklist_items",
      "work_item_history",
      "work_item_labels",
      "work_item_links",
      "work_items",
      "workflow_statuses",
    ]);
  });

  it("stores users, sessions, and settings across repositories", async () => {
    if (!database) {
      throw new Error("Database was not initialized.");
    }

    const users = new UserRepository(database);
    const sessions = new SessionRepository(database);
    const settings = new UserSettingsRepository(database);
    const hasher = new PasswordHasher();

    await users.insert({
      displayName: "Admin",
      id: "user-1",
      passwordHash: await hasher.hash("secret"),
      role: ROLE.ADMIN,
      username: "admin",
    });

    await expect(users.hasUsers()).resolves.toBe(true);
    await expect(
      users.findCredentialsByUsername("admin"),
    ).resolves.toMatchObject({ passwordHash: expect.any(String) });

    await sessions.insert({
      id: "session-1",
      lifetimeDays: 14,
      tokenHash: "token-hash",
      userId: "user-1",
    });

    await expect(sessions.findUserIdByTokenHash("token-hash")).resolves.toBe(
      "user-1",
    );

    await settings.upsertLanguage("user-1", LANGUAGE.ENGLISH);

    await expect(settings.findLanguageByUserId("user-1")).resolves.toBe(
      LANGUAGE.ENGLISH,
    );
  });

  it("keeps several sessions per user while expiring old ones", async () => {
    if (!database) {
      throw new Error("Database was not initialized.");
    }

    const users = new UserRepository(database);
    const sessions = new SessionRepository(database);

    await users.insert({
      displayName: "Admin",
      id: "user-1",
      passwordHash: "hash",
      role: ROLE.ADMIN,
      username: "admin",
    });
    await sessions.insert({
      id: "session-1",
      lifetimeDays: 14,
      tokenHash: "first",
      userId: "user-1",
    });
    await sessions.insert({
      id: "session-2",
      lifetimeDays: 14,
      tokenHash: "second",
      userId: "user-1",
    });

    await expect(sessions.findUserIdByTokenHash("first")).resolves.toBe(
      "user-1",
    );
    await expect(sessions.findUserIdByTokenHash("second")).resolves.toBe(
      "user-1",
    );

    await sessions.deleteByTokenHash("first");

    await expect(sessions.findUserIdByTokenHash("first")).resolves.toBeNull();
    await expect(sessions.findUserIdByTokenHash("second")).resolves.toBe(
      "user-1",
    );
  });

  it("rejects duplicate usernames and duplicate session tokens", async () => {
    if (!database) {
      throw new Error("Database was not initialized.");
    }

    const users = new UserRepository(database);
    const sessions = new SessionRepository(database);

    await users.insert({
      displayName: "Admin",
      id: "user-1",
      passwordHash: "hash",
      role: ROLE.ADMIN,
      username: "admin",
    });

    await expect(
      users.insert({
        displayName: "Copy",
        id: "user-2",
        passwordHash: "hash",
        role: ROLE.EMPLOYEE,
        username: "admin",
      }),
    ).rejects.toThrow('The username "admin" is already taken.');

    await sessions.insert({
      id: "session-1",
      lifetimeDays: 14,
      tokenHash: "token",
      userId: "user-1",
    });

    await expect(
      sessions.insert({
        id: "session-2",
        lifetimeDays: 14,
        tokenHash: "token",
        userId: "user-1",
      }),
    ).rejects.toThrow();
  });

  it("stores labels, archive state, and project moves across real tables", async () => {
    if (!database) {
      throw new Error("Database was not initialized.");
    }

    const users = new UserRepository(database);
    const projects = new ProjectRepository(database);
    const tasks = new TaskRepository(database);

    await users.insert({
      displayName: "Alex Berger",
      id: "user-1",
      passwordHash: "hash",
      role: ROLE.ADMIN,
      username: "alex",
    });
    await projects.insert({
      description: "Pages",
      id: "project-1",
      name: "Pages",
      ownerId: "user-1",
      placeholderColor: "#FCE3D3",
      status: "active",
    });
    await projects.insert({
      description: "Astro",
      id: "project-2",
      name: "AstroLab",
      ownerId: "user-1",
      placeholderColor: "#FCE3D3",
      status: "active",
    });

    await tasks.insert({
      assigneeId: null,
      createdBy: "user-1",
      description: "",
      dueAt: null,
      id: "item-1",
      key: "PAGE-1",
      milestoneId: null,
      number: 1,
      parentId: null,
      priority: "normal",
      projectId: "project-1",
      sortOrder: 1,
      startAt: "2026-09-01",
      statusId: "status-todo",
      title: "Ticket",
      type: "task",
    });

    await tasks.insertLabel({
      color: "#3b82f6",
      id: "label-1",
      name: "Feature",
      projectId: "project-1",
    });
    await tasks.assignLabel("item-1", "label-1");

    const active = await tasks.findAll({ projectIds: ["project-1"] });
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      key: "PAGE-1",
      reporterName: "Alex Berger",
      startAt: "2026-09-01",
    });

    const labels = await tasks.findLabelsForWorkItemIds(["item-1"]);
    expect(labels.get("item-1")).toMatchObject([{ name: "Feature" }]);
    expect(await tasks.countLabelUsage("label-1")).toBe(1);

    await tasks.archive("item-1");
    await expect(
      tasks.findAll({ projectIds: ["project-1"] }),
    ).resolves.toHaveLength(0);

    const archived = await tasks.findAll({
      archived: "archived",
      projectIds: ["project-1"],
    });
    expect(archived).toHaveLength(1);

    const everything = await tasks.findAll({
      archived: "all",
      projectIds: ["project-1"],
    });
    expect(everything).toHaveLength(1);

    await tasks.restore("item-1");
    await tasks.setGitHubError("item-1", "Forbidden");
    await expect(tasks.findById("item-1")).resolves.toMatchObject({
      githubLastError: "Forbidden",
    });

    await tasks.moveToProject("item-1", {
      assigneeId: null,
      key: "ASTRO-1",
      milestoneId: null,
      number: 1,
      parentId: null,
      projectId: "project-2",
    });
    await expect(tasks.findById("item-1")).resolves.toMatchObject({
      key: "ASTRO-1",
      projectId: "project-2",
    });
  });
});
