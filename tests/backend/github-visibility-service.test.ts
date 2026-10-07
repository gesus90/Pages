import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { GitHubApiClient } from "@/backend/github/GitHubApiClient";
import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import {
  computeGitHubContentHash,
  GitHubSyncService,
} from "@/backend/service/GitHubSyncService";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

import type { Database } from "@/backend/database/Database";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";

const ACTOR = createUser({ id: "actor" });
const OTHER = createUser({ id: "other" });
const TOKEN_KEY = Buffer.alloc(32, 7);

function issue(number: number): GitHubIssueData {
  return {
    number,
    title: `Remote ${number}`,
    body: "Remote content",
    state: "open",
    url: `https://example.invalid/issues/${number}`,
    updatedAt: "2026-10-07T01:00:00Z",
  };
}

describe("department-safe GitHub service paths", () => {
  const getDatabase = useMigratedDatabase();

  async function seedSyncData(database: Database): Promise<ProjectRepository> {
    await database.execute(`
      INSERT INTO departments (id, name) VALUES ('frontend', 'Frontend'), ('backend', 'Backend');
      INSERT INTO projects (id, name, owner_id) VALUES ('p1', 'Shared project', 'actor'), ('p2', 'Other project', 'actor');
      INSERT INTO project_departments (project_id, department_id) VALUES ('p1', 'frontend'), ('p1', 'backend'), ('p2', 'backend');
      INSERT INTO workflow_statuses (id, project_id, key, name, position, is_done) VALUES ('own-status', 'p1', 'own', 'Own status', 10, 0), ('foreign-status', 'p2', 'todo', 'Foreign todo', -10, 0);
      INSERT INTO work_items (id, project_id, key, number, type, parent_id, title, status_id, created_by, department_id, github_issue_number, archived_at)
      VALUES ('parent', 'p1', 'PAGE-1', 1, 'epic', NULL, 'Hidden parent', 'status-todo', 'actor', 'backend', NULL, NULL),
          ('front', 'p1', 'PAGE-2', 2, 'task', 'parent', 'Frontend task', 'status-todo', 'actor', 'frontend', 10, NULL),
          ('back', 'p1', 'PAGE-3', 3, 'task', NULL, 'Backend task', 'status-todo', 'actor', 'backend', 20, NULL),
          ('archived', 'p1', 'PAGE-4', 4, 'task', NULL, 'Archived backend task', 'status-todo', 'actor', 'backend', 30, '2026-01-01'),
          ('foreign', 'p2', 'OTHER-1', 1, 'task', NULL, 'Other task', 'status-todo', 'actor', NULL, NULL, NULL);
      INSERT INTO github_pull_requests (id, project_id, number, title, url, state, work_item_id)
      VALUES ('unassigned', 'p1', 1, 'Unassigned', 'https://example.invalid/1', 'open', NULL),
          ('front-pr', 'p1', 2, 'Frontend change', 'https://example.invalid/2', 'open', 'front'),
          ('back-pr', 'p1', 3, 'Backend change', 'https://example.invalid/3', 'open', 'back'),
          ('archived-pr', 'p1', 5, 'Archived change', 'https://example.invalid/5', 'open', 'archived'),
          ('foreign-pr', 'p2', 6, 'Other change', 'https://example.invalid/6', 'open', NULL);
      INSERT INTO github_external_issues (id, project_id, issue_number, title, url, state)
      VALUES ('stale-hidden', 'p1', 20, 'Previously external backend issue', 'https://example.invalid/20', 'open'),
          ('stale-archived', 'p1', 30, 'Previously external archived issue', 'https://example.invalid/30', 'open'),
          ('external', 'p1', 50, 'External issue', 'https://example.invalid/50', 'open');
    `);
    await database.execute(
      "UPDATE work_items SET github_content_hash = $hash WHERE id = 'front';",
      { hash: computeGitHubContentHash("Frontend task", "", false) },
    );
    const projectRepository = new ProjectRepository(database);
    await projectRepository.upsertIntegration("p1", {
      repoUrl: "https://github.com/example/repo",
      repoName: "example/repo",
      tokenHash: "fixture",
      tokenEncrypted: encryptGitHubToken("fixture-token", TOKEN_KEY),
      isConnected: true,
      lastSyncAt: null,
      syncComments: false,
      syncCommits: false,
      syncDirection: "pull",
      syncIntervalMinutes: 5,
      syncIssues: true,
      syncPullRequests: true,
      syncStatus: true,
    });
    return projectRepository;
  }

  async function setup() {
    const database = getDatabase();
    const authorization = new AuthorizationRepository(database);
    for (const actor of [ACTOR, OTHER]) {
      await authorization.users().insert({
        id: actor.id,
        username: actor.id,
        displayName: actor.id,
        passwordHash: "hash",
        role: "employee",
      });
      await authorization.saveRole(createRole({ name: "Scoped sync" }));
      await authorization.saveAccount(
        createAccess({
          userId: actor.id,
          departments: actor.id === "actor" ? ["frontend"] : ["backend"],
        }),
      );
    }
    const projectRepository = await seedSyncData(database);
    const cache = new ServerCache();
    const projects = new ProjectService(
      projectRepository,
      new PermissionService(),
      TOKEN_KEY,
      cache,
    );
    const repository = new TaskRepository(database);
    const tasks = new TaskService(
      repository,
      projects,
      new PermissionService(),
      cache,
    );
    const gitHubRepository = new GitHubRepository(database);
    const client = new GitHubApiClient("fixture-token", () => {
      throw new Error("Unexpected external request");
    });
    const listIssues = vi
      .spyOn(client, "listIssues")
      .mockResolvedValue([issue(10), issue(20), issue(30)]);
    vi.spyOn(client, "getIssue").mockImplementation(
      async (_owner, _repo, number) => issue(number),
    );
    vi.spyOn(client, "listPullRequests").mockResolvedValue(
      [1, 2, 3, 5].map((number) => ({
        number,
        title: `PR ${number}`,
        url: `https://example.invalid/pull/${number}`,
        state: "open",
        merged: false,
        branch: null,
        updatedAt: "2026-10-07T01:00:00Z",
      })),
    );
    const sync = new GitHubSyncService({
      taskRepository: repository,
      projectRepository,
      gitHubRepository,
      userRepository: new UserRepository(database),
      projectService: projects,
      taskService: tasks,
      tokenKey: TOKEN_KEY,
      cache,
      createClient: () => client,
    });
    return {
      authorization,
      projects,
      repository,
      tasks,
      gitHubRepository,
      client,
      listIssues,
      sync,
    };
  }

  it("isolates PR reads and assignments, including unassigned PRs in inaccessible projects", async () => {
    const { sync, authorization, gitHubRepository } = await setup();
    expect(
      await gitHubRepository.findPullRequestById("unassigned", {
        departmentIds: [],
        projectIds: [],
      }),
    ).toBeNull();
    expect(
      (await sync.findPullRequests(ACTOR, "p1")).map(
        (request) => request.number,
      ),
    ).toEqual([2, 1]);
    expect(
      (await sync.findPullRequestsByProjects(OTHER, ["p1"]))
        .get("p1")
        ?.map((request) => request.number),
    ).toEqual([5, 3, 1]);
    await expect(
      sync.assignPullRequest(ACTOR, "foreign-pr", null),
    ).rejects.toThrow("cannot be assigned");
    await expect(
      sync.assignPullRequest(ACTOR, "back-pr", null),
    ).rejects.toThrow("cannot be assigned");
    await expect(
      sync.assignPullRequest(ACTOR, "unassigned", "back"),
    ).rejects.toThrow("does not exist");
    await sync.assignPullRequest(ACTOR, "unassigned", "front");
    expect(
      (await sync.findPullRequestsByProjects(OTHER, ["p1"]))
        .get("p1")
        ?.map((request) => request.number),
    ).toEqual([5, 3]);
    expect(await sync.findPullRequestsForTask(ACTOR, "front")).toHaveLength(2);
    await authorization.saveAccount(createAccess({ departments: ["backend"] }));
    expect(
      (await sync.findPullRequestsByProjects(ACTOR, ["p1"]))
        .get("p1")
        ?.map((request) => request.number),
    ).toEqual([5, 3]);
  });

  it("synchronizes only visible tickets, preserves hidden parent relations and counts visible PRs", async () => {
    const { sync, repository, tasks } = await setup();
    expect(await sync.syncProjectNow(ACTOR, "p1")).toMatchObject({
      pulled: 1,
      detected: 0,
      pullRequests: 2,
    });
    expect(await repository.findById("front")).toMatchObject({
      title: "Remote 10",
      parentId: "parent",
      parentKey: "PAGE-1",
    });
    expect(await tasks.getById(ACTOR, "front")).toMatchObject({
      title: "Remote 10",
      parentId: null,
      parentKey: null,
    });
    expect(await repository.findById("back")).toMatchObject({
      title: "Backend task",
    });
    expect(await sync.syncSingleTask(ACTOR, "front")).toMatchObject({
      pulled: 0,
    });
    expect(await repository.findById("archived")).toMatchObject({
      title: "Archived backend task",
    });
    expect(
      (await sync.findExternalIssues(ACTOR, "p1")).map(
        (external) => external.issueNumber,
      ),
    ).toEqual([50]);
    expect(
      (await sync.findExternalIssuesByProjects(["p1"]))
        .get("p1")
        ?.map((external) => external.issueNumber),
    ).toEqual([50]);
  });

  it("rejects importing or linking known hidden local issues even from stale external rows", async () => {
    const { sync, client } = await setup();
    await expect(sync.importExternalIssue(ACTOR, "p1", 20)).rejects.toThrow(
      "cannot be imported",
    );
    await expect(sync.importExternalIssue(ACTOR, "p1", 30)).rejects.toThrow(
      "cannot be imported",
    );
    await getDatabase().execute(
      "UPDATE work_items SET github_issue_number = NULL WHERE id = 'front';",
    );
    await expect(
      sync.linkExternalIssue(ACTOR, "front", "stale-hidden"),
    ).rejects.toThrow("cannot be linked");
    expect(client.getIssue).not.toHaveBeenCalled();
    expect(
      await sync.linkExternalIssue(ACTOR, "front", "external"),
    ).toMatchObject({ parentId: null, parentKey: null, githubIssueNumber: 50 });
    expect(
      await new TaskRepository(getDatabase()).findById("front"),
    ).toMatchObject({ parentId: "parent" });
  });

  it("imports external issues with statuses from the current project only", async () => {
    const { sync } = await setup();
    expect(await sync.importExternalIssue(ACTOR, "p1", 50)).toMatchObject({
      title: "Remote 50",
      statusId: "status-backlog",
      parentId: null,
    });
  });

  it("redacts conflict-resolution DTOs and generated project activity by the referenced ticket", async () => {
    const { sync, projects } = await setup();
    await getDatabase().execute(
      "UPDATE work_items SET github_conflict = 1 WHERE id = 'front';",
    );
    expect(await sync.resolveConflict(ACTOR, "front", "github")).toMatchObject({
      parentId: null,
      parentKey: null,
      githubConflict: false,
    });
    const repository = new ProjectRepository(getDatabase());
    for (const [id, workItemId] of [
      ["front-event", "front"],
      ["back-event", "back"],
    ])
      await repository.insertActivity({
        id,
        projectId: "p1",
        userId: "actor",
        category: "integrations",
        action: "github_conflict",
        message: workItemId,
        workItemId,
      });
    await repository.insertActivity({
      id: "legacy-conflict",
      projectId: "p1",
      userId: "actor",
      category: "integrations",
      action: "github_conflict",
      message: "Unknown ticket reference",
    });
    expect(
      (await projects.findActivity(ACTOR, "p1")).map((entry) => entry.id),
    ).toEqual(["front-event"]);
    expect(
      (await projects.findActivity(OTHER, "p1")).map((entry) => entry.id),
    ).toEqual(["back-event"]);
  });

  it("rechecks the real owner before scheduled work and rechecks stale background publish DTOs", async () => {
    const { sync, authorization, listIssues, tasks } = await setup();
    const stale = await tasks.getById(ACTOR, "front");
    await authorization.saveAccount(createAccess({ departments: ["backend"] }));
    await expect(sync.publishTaskUpdate(ACTOR, stale)).rejects.toThrow(
      "does not exist",
    );
    await authorization.saveAccount(createAccess({ departments: [] }));
    const diagnostic = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(await sync.runScheduledSyncs()).toEqual({ completed: 0, failed: 1 });
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(listIssues).not.toHaveBeenCalled();
  });
});
