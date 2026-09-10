import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import {
  hashIntegrationToken,
  ProjectService,
} from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { PROJECT_STATUS } from "@/definition/Project";
import { PERMISSION, ROLE } from "@/definition/Role";

import type { Database } from "@/backend/database/Database";
import type { ProjectRepository as ProjectRepositoryType } from "@/backend/database/repositories/ProjectRepository";
import type { TaskRepository as TaskRepositoryType } from "@/backend/database/repositories/TaskRepository";
import type { ProjectService as ProjectServiceType } from "@/backend/service/ProjectService";
import type { Project } from "@/definition/Project";
import type { User } from "@/definition/User";

function createDatabase(): Database & {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    migrate: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
  } as unknown as Database & {
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
}

function createProjectRow(): unknown[] {
  return [
    "project-1",
    null,
    "Pages",
    "Description",
    PROJECT_STATUS.ACTIVE,
    10,
    "#FCE3D3",
    0,
    "user-1",
    "Alex Berger",
    "2026-09-01",
    "2026-12-15",
    "Notes",
    "2026-01-01",
    "2026-01-02",
  ];
}

function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
    ...overrides,
  };
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    createdAt: "2026-01-01",
    description: "Pages Project",
    hasIcon: false,
    id: "project-1",
    managerId: null,
    managerName: null,
    name: "Pages",
    notes: "",
    parentId: null,
    placeholderColor: "#FCE3D3",
    progress: 0,
    startDate: null,
    status: "active",
    targetDate: null,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

describe("ProjectRepository project details", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: ProjectRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new ProjectRepository(database);
  });

  it("reads extended project columns with manager names", async () => {
    database.query.mockResolvedValue([createProjectRow()]);

    await expect(repository.findById("project-1")).resolves.toMatchObject({
      managerId: "user-1",
      managerName: "Alex Berger",
      notes: "Notes",
      startDate: "2026-09-01",
      targetDate: "2026-12-15",
    });
  });

  it.each([
    [8, 42],
    [9, 42],
    [10, 42],
    [11, 42],
  ])("rejects invalid extended column %i", async (index, value) => {
    const row = createProjectRow();
    row[index] = value;
    database.query.mockResolvedValue([row]);

    await expect(repository.findById("project-1")).rejects.toThrow();
  });

  it("updates extended detail values", async () => {
    await repository.updateDetails("project-1", {
      description: "Updated",
      managerId: "user-1",
      name: "Pages",
      notes: "Notes",
      progress: 10,
      startDate: "2026-09-01",
      status: PROJECT_STATUS.ACTIVE,
      targetDate: "2026-12-15",
    });

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("manager_id = $manager_id"),
      expect.objectContaining({ manager_id: "user-1", id: "project-1" }),
    );
  });

  it("manages project members with roles", async () => {
    database.query.mockResolvedValue([
      ["user-1", "alex", "Alex Berger", "manager", "2026-01-01"],
      ["user-2", "anna", "Anna", "member", "2026-01-02"],
    ]);

    const members = await repository.findMembers("project-1");

    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({ projectRole: "manager" });

    await repository.addMember("project-1", "user-3", "viewer");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO project_members"),
      expect.objectContaining({ role: "viewer" }),
    );

    await repository.updateMemberRole("project-1", "user-2", "manager");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("role = $role"),
      expect.objectContaining({ role: "manager" }),
    );

    await repository.removeMember("project-1", "user-2");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM project_members"),
      { project_id: "project-1", user_id: "user-2" },
    );
  });

  it("rejects members with unsupported roles", async () => {
    database.query.mockResolvedValue([
      ["user-1", "alex", "Alex Berger", "superadmin", "2026-01-01"],
    ]);

    await expect(repository.findMembers("project-1")).rejects.toThrow(
      'unsupported project role "superadmin"',
    );
  });

  it("reports project managers and missing counts", async () => {
    database.query.mockResolvedValueOnce([[1n]]).mockResolvedValueOnce([[0]]);

    await expect(
      repository.isProjectManager("project-1", "user-1"),
    ).resolves.toBe(true);
    await expect(
      repository.isProjectManager("project-1", "user-2"),
    ).resolves.toBe(false);

    database.query.mockResolvedValue([]);

    await expect(
      repository.isProjectManager("project-1", "user-1"),
    ).rejects.toThrow("Database returned no manager count.");
  });

  it("manages goals", async () => {
    database.query.mockResolvedValue([
      ["goal-1", "project-1", "Ship MVP", 0, 0],
    ]);

    await expect(repository.findGoals("project-1")).resolves.toEqual([
      {
        id: "goal-1",
        isDone: false,
        position: 0,
        projectId: "project-1",
        title: "Ship MVP",
      },
    ]);

    await repository.insertGoal({
      id: "goal-2",
      position: 1,
      projectId: "project-1",
      title: "Second goal",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO project_goals"),
      expect.objectContaining({ title: "Second goal" }),
    );

    await repository.updateGoal("goal-1", "Ship MVP now", true);
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("is_done = $is_done"),
      expect.objectContaining({ is_done: 1 }),
    );

    await repository.updateGoal("goal-1", "Ship MVP later", false);
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("is_done = $is_done"),
      expect.objectContaining({ is_done: 0 }),
    );

    await repository.deleteGoal("goal-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM project_goals"),
      { id: "goal-1" },
    );
  });

  it("replaces project tags", async () => {
    database.query.mockResolvedValue([["Web"], ["Plattform"]]);

    await expect(repository.findTags("project-1")).resolves.toEqual([
      "Web",
      "Plattform",
    ]);

    await repository.setTags("project-1", ["Web", "Intern"]);

    expect(database.execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("DELETE FROM project_tags"),
      { project_id: "project-1" },
    );
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO project_tags"),
      { project_id: "project-1", tag: "Intern" },
    );
  });

  it("manages planning dates", async () => {
    database.query.mockResolvedValue([
      [
        "event-1",
        "project-1",
        "MVP",
        "Release",
        "2026-09-30",
        "10:00",
        "milestone",
        "2026-01-01",
        "2026-01-02",
      ],
    ]);

    await expect(repository.findEvents("project-1")).resolves.toEqual([
      expect.objectContaining({ eventTime: "10:00", title: "MVP" }),
    ]);

    await repository.insertEvent({
      description: "",
      eventDate: "2026-10-15",
      eventTime: null,
      id: "event-2",
      projectId: "project-1",
      title: "Review",
      type: "general",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO project_events"),
      expect.objectContaining({ event_time: null }),
    );

    await repository.updateEvent("event-1", {
      description: "Updated",
      eventDate: "2026-09-30",
      eventTime: "11:00",
      title: "MVP",
      type: "milestone",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("event_time = $event_time"),
      expect.objectContaining({ event_time: "11:00" }),
    );

    await repository.archiveEvent("event-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("archived_at = CURRENT_TIMESTAMP"),
      { id: "event-1" },
    );
  });

  it("rejects planning dates with invalid times", async () => {
    database.query.mockResolvedValue([
      [
        "event-1",
        "project-1",
        "MVP",
        "",
        "2026-09-30",
        42,
        "general",
        "2026-01-01",
        "2026-01-02",
      ],
    ]);

    await expect(repository.findEvents("project-1")).rejects.toThrow(
      'invalid value for "event_time"',
    );
  });

  it("returns sanitized integrations and stores secrets as hashes", async () => {
    database.query.mockResolvedValueOnce([]);

    await expect(repository.findIntegration("project-1")).resolves.toBeNull();

    await repository.upsertIntegration("project-1", {
      isConnected: false,
      lastSyncAt: null,
      repoName: "user/pages",
      repoUrl: "https://github.com/user/pages.git",
      syncComments: true,
      syncCommits: false,
      syncDirection: "bidirectional",
      syncIntervalMinutes: 15,
      syncIssues: true,
      syncPullRequests: false,
      syncStatus: true,
      tokenEncrypted: "encrypted-value",
      tokenHash: "hash-value",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO project_integrations"),
      expect.objectContaining({
        has_token: 1,
        repo_url: "https://github.com/user/pages.git",
      }),
    );
    expect(database.execute).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ token: expect.anything() }),
    );

    database.query.mockResolvedValue([
      [
        "project-1",
        "https://github.com/user/pages.git",
        1,
        1,
        1,
        1,
        0,
        0,
        "push",
        15,
        1,
        "user/pages",
        "2026-09-05",
        "2026-09-05T14:36:00.000Z",
        "2026-09-05",
      ],
    ]);

    await expect(repository.findIntegration("project-1")).resolves.toEqual(
      expect.objectContaining({
        hasToken: true,
        isConnected: true,
        nextSyncAt: "2026-09-05T14:36:00.000Z",
        syncDirection: "push",
        syncIntervalMinutes: 15,
      }),
    );

    await repository.upsertIntegration("project-1", {
      isConnected: true,
      lastSyncAt: "2026-09-05",
      repoName: "user/pages",
      repoUrl: "https://github.com/user/pages.git",
      syncComments: true,
      syncCommits: false,
      syncDirection: "push",
      syncIntervalMinutes: 30,
      syncIssues: true,
      syncPullRequests: false,
      syncStatus: true,
      tokenEncrypted: null,
      tokenHash: null,
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("token_hash = COALESCE"),
      expect.objectContaining({ token_hash: null }),
    );

    await repository.upsertIntegration("project-1", {
      isConnected: false,
      lastSyncAt: null,
      repoName: null,
      repoUrl: "",
      syncComments: false,
      syncCommits: true,
      syncDirection: "pull",
      syncIntervalMinutes: 5,
      syncIssues: false,
      syncPullRequests: true,
      syncStatus: false,
      tokenEncrypted: "another-encrypted",
      tokenHash: "another-hash",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("token_hash = COALESCE"),
      expect.objectContaining({
        sync_issues: 0,
        sync_status: 0,
        sync_comments: 0,
        token_hash: "another-hash",
      }),
    );

    await repository.deleteIntegration("project-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM project_integrations"),
      { project_id: "project-1" },
    );
  });

  it("stores integrations without secrets and clears disconnected tokens", async () => {
    database.query.mockResolvedValue([]);

    await repository.upsertIntegration("project-1", {
      isConnected: true,
      lastSyncAt: null,
      repoName: null,
      repoUrl: "",
      syncComments: false,
      syncCommits: true,
      syncDirection: "pull",
      syncIntervalMinutes: 0,
      syncIssues: false,
      syncPullRequests: true,
      syncStatus: false,
      tokenEncrypted: null,
      tokenHash: null,
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO project_integrations"),
      expect.objectContaining({
        has_token: 0,
        is_connected: 1,
        sync_direction: "pull",
        sync_issues: 0,
      }),
    );

    database.query.mockResolvedValue([
      [
        "project-1",
        "",
        0,
        0,
        0,
        0,
        0,
        0,
        "pull",
        15,
        0,
        null,
        null,
        null,
        "2026-09-05",
      ],
    ]);

    await repository.upsertIntegration("project-1", {
      isConnected: false,
      lastSyncAt: null,
      repoName: null,
      repoUrl: "",
      syncComments: false,
      syncCommits: false,
      syncDirection: "pull",
      syncIntervalMinutes: 15,
      syncIssues: false,
      syncPullRequests: false,
      syncStatus: false,
      tokenEncrypted: null,
      tokenHash: null,
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("token_hash = COALESCE"),
      expect.objectContaining({ clear_token: 1 }),
    );
  });

  it("maps unknown sync directions to bidirectional", async () => {
    database.query.mockResolvedValue([
      [
        "project-1",
        "https://github.com/user/pages.git",
        0,
        1,
        1,
        1,
        0,
        0,
        "sideways",
        15,
        0,
        null,
        null,
        null,
        "2026-09-05",
      ],
    ]);

    await expect(repository.findIntegration("project-1")).resolves.toEqual(
      expect.objectContaining({
        repoName: null,
        lastSyncAt: null,
        syncDirection: "bidirectional",
      }),
    );
  });

  it("rejects integrations with invalid stored values", async () => {
    database.query.mockResolvedValue([
      [
        "project-1",
        "https://github.com/user/pages.git",
        1,
        1,
        1,
        1,
        0,
        0,
        "bidirectional",
        42,
        0,
        null,
        null,
        null,
        "2026-09-05",
      ],
    ]);

    await expect(repository.findIntegration("project-1")).rejects.toThrow(
      'invalid value for "sync_interval_minutes"',
    );

    database.query.mockResolvedValue([
      [
        "project-1",
        "https://github.com/user/pages.git",
        1,
        1,
        1,
        1,
        0,
        0,
        "bidirectional",
        15,
        0,
        42,
        null,
        null,
        "2026-09-05",
      ],
    ]);

    await expect(repository.findIntegration("project-1")).rejects.toThrow(
      'invalid value for "repo_name"',
    );

    database.query.mockResolvedValue([
      [
        "project-1",
        "https://github.com/user/pages.git",
        1,
        1,
        1,
        1,
        0,
        0,
        "bidirectional",
        15,
        0,
        null,
        42,
        null,
        "2026-09-05",
      ],
    ]);

    await expect(repository.findIntegration("project-1")).rejects.toThrow(
      'invalid value for "last_sync_at"',
    );

    database.query.mockResolvedValue([
      [
        "project-1",
        "https://github.com/user/pages.git",
        1,
        1,
        1,
        1,
        0,
        0,
        "bidirectional",
        15,
        0,
        null,
        null,
        42,
        "2026-09-05",
      ],
    ]);

    await expect(repository.findIntegration("project-1")).rejects.toThrow(
      'invalid value for "next_sync_at"',
    );
  });

  it("reads encrypted tokens server-side and lists due synchronizations", async () => {
    database.query.mockResolvedValue([[null]]);

    await expect(
      repository.findTokenEncrypted("project-1"),
    ).resolves.toBeNull();

    database.query.mockResolvedValue([]);

    await expect(
      repository.findTokenEncrypted("project-1"),
    ).resolves.toBeNull();

    database.query.mockResolvedValue([["encrypted-token"]]);

    await expect(repository.findTokenEncrypted("project-1")).resolves.toBe(
      "encrypted-token",
    );
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("token_encrypted"),
      { project_id: "project-1" },
    );

    database.query.mockResolvedValue([
      ["project-1", "user-1"],
      ["project-2", "user-2"],
    ]);

    await expect(
      repository.findDueSyncIntegrations("2026-09-05T14:21:00.000Z"),
    ).resolves.toEqual([
      { ownerId: "user-1", projectId: "project-1" },
      { ownerId: "user-2", projectId: "project-2" },
    ]);
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("next_sync_at"),
      { now: "2026-09-05T14:21:00.000Z" },
    );

    await repository.updateSyncSchedule("project-1", {
      lastSyncAt: "2026-09-05T14:21:00.000Z",
      nextSyncAt: "2026-09-05T14:36:00.000Z",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("next_sync_at = $next_sync_at"),
      expect.objectContaining({ project_id: "project-1" }),
    );
  });

  it("records and reads the activity log", async () => {
    database.query.mockResolvedValue([
      [
        "activity-1",
        "project-1",
        "user-1",
        "Alex",
        "team",
        "member_added",
        "Anna was added.",
        "2026-09-05",
      ],
    ]);

    await expect(repository.findActivity("project-1")).resolves.toEqual([
      {
        action: "member_added",
        category: "team",
        createdAt: "2026-09-05",
        id: "activity-1",
        message: "Anna was added.",
        projectId: "project-1",
        userDisplayName: "Alex",
        userId: "user-1",
      },
    ]);

    await repository.insertActivity({
      action: "member_added",
      category: "team",
      id: "activity-2",
      message: "Max was added.",
      projectId: "project-1",
      userId: "user-1",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO project_activity"),
      expect.objectContaining({ action: "member_added" }),
    );
  });

  it("rejects activity entries with invalid display names", async () => {
    database.query.mockResolvedValue([
      [
        "activity-1",
        "project-1",
        "user-1",
        42,
        "team",
        "member_added",
        "Anna was added.",
        "2026-09-05",
      ],
    ]);

    await expect(repository.findActivity("project-1")).rejects.toThrow(
      'invalid value for "user_display_name"',
    );
  });
});

type MockMap = { [key: string]: ReturnType<typeof vi.fn> };

function createServiceDependencies(): {
  repository: MockMap;
  permissions: MockMap;
  service: ProjectService;
} {
  const repository = {
    addMember: vi.fn(),
    archive: vi.fn(),
    archiveEvent: vi.fn(),
    deleteGoal: vi.fn(),
    deleteIntegration: vi.fn(),
    findActivity: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(createProject()),
    findByMemberId: vi.fn().mockResolvedValue([]),
    findEvents: vi.fn().mockResolvedValue([]),
    findGoals: vi.fn().mockResolvedValue([]),
    findIconByProjectId: vi.fn(),
    findIntegration: vi.fn().mockResolvedValue(null),
    findMembers: vi.fn().mockResolvedValue([]),
    findTags: vi.fn().mockResolvedValue([]),
    insert: vi.fn(),
    insertActivity: vi.fn(),
    insertEvent: vi.fn(),
    insertGoal: vi.fn(),
    isMember: vi.fn().mockResolvedValue(true),
    isProjectManager: vi.fn().mockResolvedValue(false),
    removeMember: vi.fn(),
    setTags: vi.fn(),
    upsertIcon: vi.fn(),
    upsertIntegration: vi.fn(),
    update: vi.fn(),
    updateDetails: vi.fn(),
    updateEvent: vi.fn(),
    updateGoal: vi.fn(),
    updateMemberRole: vi.fn(),
  } as unknown as MockMap;
  const permissions = {
    hasPermission: vi.fn(
      (_role: unknown, permission: string) =>
        permission === PERMISSION.MANAGE_PROJECTS ||
        permission === PERMISSION.PARTICIPATE_IN_PROJECTS,
    ),
  } as unknown as MockMap;

  return {
    permissions,
    repository,
    service: new ProjectService(
      repository as unknown as ProjectRepositoryType,
      permissions as unknown as PermissionService,
      Buffer.alloc(32, 7),
    ),
  };
}

describe("ProjectService project details", () => {
  let dependencies: ReturnType<typeof createServiceDependencies>;

  beforeEach(() => {
    dependencies = createServiceDependencies();
  });

  it("updates details after validating manager membership", async () => {
    const { repository, service } = dependencies;
    repository.findMembers.mockResolvedValue([
      {
        displayName: "Alex",
        joinedAt: "2026-01-01",
        projectRole: "manager",
        userId: "user-1",
        username: "alex",
      },
    ]);

    const updated = await service.updateDetails(createUser(), "project-1", {
      description: "New description",
      managerId: "user-1",
      name: "Pages",
      notes: "Notes",
      progress: 0,
      startDate: "2026-09-01",
      status: "active",
      targetDate: "2026-12-15",
    });

    expect(updated.id).toBe("project-1");
    expect(repository.updateDetails).toHaveBeenCalled();
    expect(repository.insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "project_updated" }),
    );
  });

  it("rejects invalid detail input", async () => {
    const { service } = dependencies;
    const actor = createUser();

    await expect(
      service.updateDetails(actor, "project-1", {
        description: "",
        managerId: null,
        name: "   ",
        notes: "",
        progress: 0,
        startDate: null,
        status: "active",
        targetDate: null,
      }),
    ).rejects.toThrow("between 1 and 200 characters");

    await expect(
      service.updateDetails(actor, "project-1", {
        description: "",
        managerId: null,
        name: "Pages",
        notes: "x".repeat(10_001),
        progress: 0,
        startDate: null,
        status: "active",
        targetDate: null,
      }),
    ).rejects.toThrow("must not exceed 10,000 characters");
  });

  it("rejects managers outside the project", async () => {
    const { repository, service } = dependencies;
    repository.findMembers.mockResolvedValue([]);

    await expect(
      service.updateDetails(createUser(), "project-1", {
        description: "",
        managerId: "user-9",
        name: "Pages",
        notes: "",
        progress: 0,
        startDate: null,
        status: "active",
        targetDate: null,
      }),
    ).rejects.toThrow("must be a member of the project");
  });

  it("reports missing projects after detail updates", async () => {
    const { repository, service } = dependencies;
    repository.findById.mockResolvedValue(createProject());
    repository.findMembers.mockResolvedValue([]);

    await service.updateDetails(createUser(), "project-1", {
      description: "",
      managerId: null,
      name: "Pages",
      notes: "",
      progress: 0,
      startDate: null,
      status: "active",
      targetDate: null,
    });

    repository.findById.mockResolvedValueOnce(createProject());
    repository.findById.mockResolvedValueOnce(null);

    await expect(
      service.updateDetails(createUser(), "project-1", {
        description: "",
        managerId: null,
        name: "Pages",
        notes: "",
        progress: 0,
        startDate: null,
        status: "active",
        targetDate: null,
      }),
    ).rejects.toThrow("does not exist");
  });

  it("denies detail writes without project permission", async () => {
    const { permissions, service } = dependencies;
    permissions.hasPermission.mockReturnValue(false);

    await expect(
      service.updateDetails(createUser({ role: ROLE.EMPLOYEE }), "project-1", {
        description: "",
        managerId: null,
        name: "Pages",
        notes: "",
        progress: 0,
        startDate: null,
        status: "active",
        targetDate: null,
      }),
    ).rejects.toThrow("not allowed to manage projects");
  });

  it("allows project managers to write without global permission", async () => {
    const { permissions, repository, service } = dependencies;
    permissions.hasPermission.mockImplementation(
      (_role: unknown, permission: string) =>
        permission === PERMISSION.PARTICIPATE_IN_PROJECTS,
    );
    repository.isProjectManager.mockResolvedValue(true);
    repository.findMembers.mockResolvedValue([]);

    await service.updateDetails(
      createUser({ role: ROLE.EMPLOYEE }),
      "project-1",
      {
        description: "",
        managerId: null,
        name: "Pages",
        notes: "",
        progress: 0,
        startDate: null,
        status: "active",
        targetDate: null,
      },
    );

    expect(repository.updateDetails).toHaveBeenCalled();
  });

  it("checks project write permission", async () => {
    const { permissions, repository, service } = dependencies;

    await expect(
      service.canWriteProject(createUser(), "project-1"),
    ).resolves.toBe(true);

    permissions.hasPermission.mockImplementation(
      (_role: unknown, permission: string) =>
        permission === PERMISSION.PARTICIPATE_IN_PROJECTS,
    );
    const employee = createUser({ role: ROLE.EMPLOYEE });
    repository.isProjectManager.mockResolvedValueOnce(true);
    await expect(service.canWriteProject(employee, "project-1")).resolves.toBe(
      true,
    );
    repository.isProjectManager.mockResolvedValueOnce(false);
    await expect(service.canWriteProject(employee, "project-1")).resolves.toBe(
      false,
    );
  });

  it("manages members and validates roles", async () => {
    const { repository, service } = dependencies;
    const actor = createUser();

    await service.addMember(actor, "project-1", "user-2", "member");
    expect(repository.addMember).toHaveBeenCalledWith(
      "project-1",
      "user-2",
      "member",
    );

    await service.updateMemberRole(actor, "project-1", "user-2", "viewer");
    expect(repository.updateMemberRole).toHaveBeenCalled();

    await service.removeMember(actor, "project-1", "user-2");
    expect(repository.removeMember).toHaveBeenCalled();

    await expect(
      service.addMember(actor, "project-1", "user-2", "superadmin" as never),
    ).rejects.toThrow("Unsupported project role");
    await expect(
      service.updateMemberRole(
        actor,
        "project-1",
        "user-2",
        "superadmin" as never,
      ),
    ).rejects.toThrow("Unsupported project role");
  });

  it("reads members, goals, tags, events, and activity", async () => {
    const { repository, service } = dependencies;
    const actor = createUser();

    await service.findMembers(actor, "project-1");
    await service.findGoals(actor, "project-1");
    await service.findTags(actor, "project-1");
    await service.findEvents(actor, "project-1");
    await service.findActivity(actor, "project-1");
    await service.findIntegration(actor, "project-1");

    expect(repository.findMembers).toHaveBeenCalledWith("project-1");
    expect(repository.findGoals).toHaveBeenCalledWith("project-1");
    expect(repository.findTags).toHaveBeenCalledWith("project-1");
    expect(repository.findEvents).toHaveBeenCalledWith("project-1");
    expect(repository.findActivity).toHaveBeenCalledWith("project-1");
    expect(repository.findIntegration).toHaveBeenCalledWith("project-1");
  });

  it("creates, updates, and deletes goals", async () => {
    const { repository, service } = dependencies;
    const actor = createUser();

    await service.createGoal(actor, "project-1", "  Ship MVP  ");
    expect(repository.insertGoal).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Ship MVP" }),
    );

    await expect(service.createGoal(actor, "project-1", "   ")).rejects.toThrow(
      "between 1 and 200 characters",
    );

    await service.updateGoal(actor, "project-1", "goal-1", "Ship it", true);
    expect(repository.updateGoal).toHaveBeenCalledWith(
      "goal-1",
      "Ship it",
      true,
    );
    await expect(
      service.updateGoal(actor, "project-1", "goal-1", "", false),
    ).rejects.toThrow("between 1 and 200 characters");

    await service.deleteGoal(actor, "project-1", "goal-1");
    expect(repository.deleteGoal).toHaveBeenCalledWith("goal-1");
  });

  it("cleans tags before persisting", async () => {
    const { repository, service } = dependencies;

    await service.setTags(createUser(), "project-1", [
      "  Web ",
      "",
      "Web",
      "Plattform",
    ]);

    expect(repository.setTags).toHaveBeenCalledWith("project-1", [
      "Web",
      "Plattform",
    ]);
  });

  it("creates, updates, and archives planning dates", async () => {
    const { repository, service } = dependencies;
    const actor = createUser();

    await service.createEvent(actor, "project-1", {
      description: " Desc ",
      eventDate: "2026-09-30",
      eventTime: "10:00",
      title: " MVP ",
      type: "milestone",
    });
    expect(repository.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "MVP" }),
    );

    await service.createEvent(actor, "project-1", {
      description: "",
      eventDate: "2026-10-01",
      eventTime: "   ",
      title: "Kickoff",
      type: "   ",
    });
    expect(repository.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventTime: null,
        title: "Kickoff",
        type: "general",
      }),
    );

    await expect(
      service.createEvent(actor, "project-1", {
        description: "",
        eventDate: "2026-09-30",
        eventTime: null,
        title: "",
        type: "general",
      }),
    ).rejects.toThrow("between 1 and 200 characters");

    await expect(
      service.createEvent(actor, "project-1", {
        description: "",
        eventDate: "30.09.2026",
        eventTime: null,
        title: "MVP",
        type: "general",
      }),
    ).rejects.toThrow("YYYY-MM-DD");

    await service.updateEvent(actor, "project-1", "event-1", {
      description: "",
      eventDate: "2026-09-30",
      eventTime: null,
      title: "MVP",
      type: "   ",
    });
    expect(repository.updateEvent).toHaveBeenCalledWith(
      "event-1",
      expect.objectContaining({ type: "general" }),
    );

    await expect(
      service.updateEvent(actor, "project-1", "event-1", {
        description: "",
        eventDate: "2026-09-30",
        eventTime: null,
        title: "",
        type: "general",
      }),
    ).rejects.toThrow("between 1 and 200 characters");

    await expect(
      service.updateEvent(actor, "project-1", "event-1", {
        description: "",
        eventDate: "tomorrow",
        eventTime: null,
        title: "MVP",
        type: "general",
      }),
    ).rejects.toThrow("YYYY-MM-DD");

    await service.archiveEvent(actor, "project-1", "event-1");
    expect(repository.archiveEvent).toHaveBeenCalledWith("event-1");
  });

  it("saves integrations with hashed secrets and validates addresses", async () => {
    const { repository, service } = dependencies;
    const actor = createUser();

    await service.saveIntegration(actor, "project-1", {
      repoUrl: "https://github.com/user/pages.git",
      syncComments: true,
      syncCommits: false,
      syncDirection: "bidirectional",
      syncIntervalMinutes: 15,
      syncIssues: true,
      syncPullRequests: false,
      syncStatus: true,
      token: "ghp-example",
    });

    expect(repository.upsertIntegration).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        repoName: "user/pages",
        repoUrl: "https://github.com/user/pages.git",
        syncIntervalMinutes: 15,
        tokenEncrypted: expect.any(String),
        tokenHash: hashIntegrationToken("ghp-example"),
      }),
    );

    const stored = repository.upsertIntegration.mock.calls[0]?.[1] as {
      tokenEncrypted: string;
    };
    expect(stored.tokenEncrypted).not.toContain("ghp-example");

    await service.saveIntegration(actor, "project-1", {
      repoUrl: "",
      syncComments: true,
      syncCommits: false,
      syncDirection: "pull",
      syncIntervalMinutes: 0,
      syncIssues: true,
      syncPullRequests: false,
      syncStatus: true,
      token: "",
    });
    expect(repository.upsertIntegration).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        repoName: null,
        syncIntervalMinutes: 0,
        tokenEncrypted: null,
        tokenHash: null,
      }),
    );

    await expect(
      service.saveIntegration(actor, "project-1", {
        repoUrl: "https://gitlab.com/user/pages.git",
        syncComments: true,
        syncCommits: false,
        syncDirection: "bidirectional",
        syncIntervalMinutes: 15,
        syncIssues: true,
        syncPullRequests: false,
        syncStatus: true,
        token: "",
      }),
    ).rejects.toThrow("must look like https://github.com");

    await expect(
      service.saveIntegration(actor, "project-1", {
        repoUrl: "",
        syncComments: true,
        syncCommits: false,
        syncDirection: "bidirectional",
        syncIntervalMinutes: 42 as never,
        syncIssues: true,
        syncPullRequests: false,
        syncStatus: true,
        token: "",
      }),
    ).rejects.toThrow("Sync interval must be 0, 5, 15, 30, or 60 minutes.");
  });

  it("refuses token storage without a server-side encryption key", async () => {
    const { repository, permissions } = dependencies;
    const keyless = new ProjectService(
      repository as unknown as ProjectRepositoryType,
      permissions as unknown as PermissionService,
    );

    await expect(
      keyless.saveIntegration(createUser(), "project-1", {
        repoUrl: "",
        syncComments: true,
        syncCommits: false,
        syncDirection: "bidirectional",
        syncIntervalMinutes: 15,
        syncIssues: true,
        syncPullRequests: false,
        syncStatus: true,
        token: "ghp-example",
      }),
    ).rejects.toThrow("not configured on this server");
  });

  it("disconnects integrations including stored secrets", async () => {
    const { repository, service } = dependencies;
    const actor = createUser();

    await service.disconnectIntegration(actor, "project-1");
    expect(repository.deleteIntegration).toHaveBeenCalledWith("project-1");
  });

  it("hashes integration tokens deterministically", () => {
    const first = hashIntegrationToken("ghp-example");
    const second = hashIntegrationToken("ghp-example");

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIntegrationToken("other")).not.toBe(first);
    expect(first).not.toContain("ghp-example");
  });
});

function createMilestone(overrides: Record<string, unknown> = {}) {
  return {
    archivedAt: null,
    completedAt: null,
    createdAt: "2026-01-01",
    description: "First release",
    dueAt: "2026-09-30",
    id: "milestone-1",
    name: "MVP",
    projectId: "project-1",
    startAt: null,
    status: "open",
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

describe("TaskRepository milestones and project history", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: TaskRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new TaskRepository(database);
  });

  it("inserts and updates milestones", async () => {
    await repository.insertMilestone({
      description: "First release",
      dueAt: "2026-09-30",
      id: "milestone-1",
      name: "MVP",
      projectId: "project-1",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO milestones"),
      expect.objectContaining({ name: "MVP" }),
    );

    await repository.updateMilestone("milestone-1", {
      description: "Updated",
      dueAt: null,
      name: "MVP",
      status: "completed",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("completed_at = CASE"),
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("returns project work item history", async () => {
    database.query.mockResolvedValue([
      [
        "history-1",
        "item-1",
        "user-1",
        "Alex",
        "status_changed",
        "status",
        "To Do",
        "In Arbeit",
        "2026-09-05",
      ],
    ]);

    await expect(
      repository.findHistoryByProjectId("project-1"),
    ).resolves.toEqual([
      expect.objectContaining({
        action: "status_changed",
        userDisplayName: "Alex",
      }),
    ]);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("INNER JOIN work_items"),
      { project_id: "project-1" },
    );
  });
});

function createTaskServiceDependencies(): {
  repository: MockMap;
  projectService: MockMap;
  service: TaskService;
} {
  const repository = {
    findHistoryByProjectId: vi.fn().mockResolvedValue([]),
    findMilestoneById: vi.fn().mockResolvedValue(createMilestone()),
    insertMilestone: vi.fn(),
    updateMilestone: vi.fn(),
  } as unknown as MockMap;
  const projectService = {
    canWriteProject: vi.fn().mockResolvedValue(true),
    getById: vi.fn().mockResolvedValue(createProject()),
  } as unknown as MockMap;

  return {
    projectService,
    repository,
    service: new TaskService(
      repository as unknown as TaskRepositoryType,
      projectService as unknown as ProjectServiceType,
      new PermissionService(),
    ),
  };
}

describe("TaskService milestones", () => {
  let dependencies: ReturnType<typeof createTaskServiceDependencies>;

  beforeEach(() => {
    dependencies = createTaskServiceDependencies();
  });

  it("creates milestones after validation", async () => {
    const { service } = dependencies;
    const actor = createUser();

    const created = await service.createMilestone(actor, {
      description: "First release",
      dueAt: "2026-09-30",
      name: "MVP",
      projectId: "project-1",
    });

    expect(created.id).toBe("milestone-1");

    await expect(
      service.createMilestone(actor, {
        name: "   ",
        projectId: "project-1",
      }),
    ).rejects.toThrow("between 1 and 200 characters");

    await expect(
      service.createMilestone(actor, {
        dueAt: "30.09.2026",
        name: "MVP",
        projectId: "project-1",
      }),
    ).rejects.toThrow("YYYY-MM-DD");
  });

  it("denies milestone creation without write permission", async () => {
    const { projectService, service } = dependencies;
    projectService.canWriteProject.mockResolvedValue(false);

    await expect(
      service.createMilestone(createUser(), {
        name: "MVP",
        projectId: "project-1",
      }),
    ).rejects.toThrow("not allowed to access tasks");
  });

  it("updates milestones after validation", async () => {
    const { repository, service } = dependencies;
    const actor = createUser();

    repository.findMilestoneById.mockResolvedValue({
      description: "Old",
      dueAt: null,
      id: "milestone-1",
      name: "MVP",
      projectId: "project-1",
      status: "open",
    });

    const updated = await service.updateMilestone(actor, "milestone-1", {
      description: "New",
      dueAt: "2026-09-30",
      name: "MVP",
      status: "completed",
    });

    expect(updated.name).toBe("MVP");

    repository.findMilestoneById.mockResolvedValue(null);
    await expect(
      service.updateMilestone(actor, "milestone-1", {
        description: "",
        dueAt: null,
        name: "MVP",
        status: "open",
      }),
    ).rejects.toThrow("does not exist");

    repository.findMilestoneById.mockResolvedValue({
      description: "",
      dueAt: null,
      id: "milestone-1",
      name: "MVP",
      projectId: "project-1",
      status: "open",
    });
    await expect(
      service.updateMilestone(actor, "milestone-1", {
        description: "",
        dueAt: null,
        name: "",
        status: "open",
      }),
    ).rejects.toThrow("between 1 and 200 characters");

    await expect(
      service.updateMilestone(actor, "milestone-1", {
        description: "",
        dueAt: "tomorrow",
        name: "MVP",
        status: "open",
      }),
    ).rejects.toThrow("YYYY-MM-DD");

    await expect(
      service.updateMilestone(actor, "milestone-1", {
        description: "",
        dueAt: null,
        name: "MVP",
        status: "unknown" as never,
      }),
    ).rejects.toThrow("Unsupported milestone status");
  });

  it("denies milestone updates without write permission", async () => {
    const { projectService, service } = dependencies;
    projectService.canWriteProject.mockResolvedValue(false);
    projectService.getById.mockResolvedValue(createProject());

    await expect(
      service.updateMilestone(createUser(), "milestone-1", {
        description: "",
        dueAt: null,
        name: "MVP",
        status: "open",
      }),
    ).rejects.toThrow("not allowed to access tasks");
  });

  it("reports missing milestones after creation and update", async () => {
    const { repository, service } = dependencies;
    const actor = createUser();

    repository.findMilestoneById.mockResolvedValueOnce(null);

    await expect(
      service.createMilestone(actor, {
        name: "MVP",
        projectId: "project-1",
      }),
    ).rejects.toThrow("could not be retrieved");

    repository.findMilestoneById.mockReset();
    repository.findMilestoneById
      .mockResolvedValueOnce(createMilestone())
      .mockResolvedValueOnce(null);

    await expect(
      service.updateMilestone(actor, "milestone-1", {
        description: "",
        dueAt: null,
        name: "MVP",
        status: "open",
      }),
    ).rejects.toThrow("could not be retrieved");
  });

  it("returns project history after verifying access", async () => {
    const { projectService, repository, service } = dependencies;
    const actor = createUser();

    await service.findHistoryByProject(actor, "project-1");

    expect(projectService.getById).toHaveBeenCalledWith(actor, "project-1");
    expect(repository.findHistoryByProjectId).toHaveBeenCalledWith("project-1");
  });
});
