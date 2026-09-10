import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { action, loader } from "@/app/routes/project-detail";
import {
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/service/ProjectService";
import { WorkItemValidationError } from "@/backend/service/TaskService";
import { ROLE } from "@/definition/Role";

import type { Project } from "@/definition/Project";
import type { User } from "@/definition/User";
import type { LoaderFunctionArgs } from "react-router";

const mockedServices = vi.mocked(getApplicationServices);

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

function createServices(overrides: Record<string, unknown> = {}) {
  return {
    projectService: {
      addMember: vi.fn(),
      archive: vi.fn(),
      archiveEvent: vi.fn(),
      canWriteProject: vi.fn().mockResolvedValue(true),
      createEvent: vi.fn(),
      createGoal: vi.fn(),
      deleteGoal: vi.fn(),
      disconnectIntegration: vi.fn(),
      findActivity: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(createProject()),
      findEvents: vi.fn().mockResolvedValue([]),
      findGoals: vi.fn().mockResolvedValue([]),
      findIntegration: vi.fn().mockResolvedValue(null),
      findMembers: vi.fn().mockResolvedValue([]),
      findTags: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockResolvedValue(createProject()),
      removeMember: vi.fn(),
      saveIntegration: vi.fn().mockResolvedValue(null),
      setTags: vi.fn(),
      updateDetails: vi.fn(),
      updateEvent: vi.fn(),
      updateGoal: vi.fn(),
      updateMemberRole: vi.fn(),
    },
    gitHubSyncService: {
      syncProjectNow: vi.fn(),
      testConnection: vi.fn().mockResolvedValue(true),
    },
    taskService: {
      createMilestone: vi.fn(),
      findAll: vi.fn().mockResolvedValue([]),
      findAllStatuses: vi.fn().mockResolvedValue([]),
      findEligibleAssignees: vi.fn().mockResolvedValue([]),
      findHistoryByProject: vi.fn().mockResolvedValue([]),
      findMilestones: vi.fn().mockResolvedValue([
        {
          description: "First release",
          dueAt: "2026-09-30",
          id: "milestone-1",
          name: "MVP",
          projectId: "project-1",
          status: "open",
        },
      ]),
      updateMilestone: vi.fn(),
    },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof mockedServices>>;
}

function createPostRequest(
  entries: Record<string, string | undefined>,
): Request {
  const formData = new URLSearchParams();

  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) {
      formData.append(key, value);
    }
  }

  return new Request("http://pages.invalid/projekte/project-1", {
    body: formData,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

describe("project detail route loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedServices.mockResolvedValue(createServices());
  });

  it("throws without an authenticated user", async () => {
    const context = new Map();
    const request = new Request("http://pages.invalid/projekte/project-1");

    await expect(
      loader({
        context,
        params: { projectId: "project-1" },
        request,
      } as unknown as LoaderFunctionArgs),
    ).rejects.toThrow("Authenticated middleware did not provide a user.");
  });

  it("loads the project aggregate and keeps the selected tab on reload", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request(
      "http://pages.invalid/projekte/project-1?tab=team",
    );

    const result = await loader({
      context,
      params: { projectId: "project-1" },
      request,
    } as unknown as LoaderFunctionArgs);

    expect(result.project.id).toBe("project-1");
    expect(result.activeTab).toBe("team");
    expect(result.canWrite).toBe(true);
  });

  it("maps missing project identifiers to 404", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request("http://pages.invalid/projekte/project-1");

    await expect(
      loader({
        context,
        params: {},
        request,
      } as unknown as LoaderFunctionArgs),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("falls back to the general tab for unknown tab values", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request(
      "http://pages.invalid/projekte/project-1?tab=bogus",
    );

    const result = await loader({
      context,
      params: { projectId: "project-1" },
      request,
    } as unknown as LoaderFunctionArgs);

    expect(result.activeTab).toBe("general");
  });

  it("falls back to the general tab when no tab parameter is present", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request("http://pages.invalid/projekte/project-1");

    const result = await loader({
      context,
      params: { projectId: "project-1" },
      request,
    } as unknown as LoaderFunctionArgs);

    expect(result.activeTab).toBe("general");
  });

  it.each(["planning", "integrations", "activity"])(
    "loads the %s tab with only its required aggregate data",
    async (tab) => {
      const context = new Map([[authenticatedUserContext, createUser()]]);
      const request = new Request(
        `http://pages.invalid/projekte/project-1?tab=${tab}`,
      );

      const result = await loader({
        context,
        params: { projectId: "project-1" },
        request,
      } as unknown as LoaderFunctionArgs);

      expect(result.activeTab).toBe(tab);
    },
  );

  it("continues without assignable users when lookup fails", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        taskService: {
          findAll: vi.fn().mockResolvedValue([]),
          findAllStatuses: vi.fn().mockResolvedValue([]),
          findEligibleAssignees: vi
            .fn()
            .mockRejectedValue(new Error("Unavailable")),
          findHistoryByProject: vi.fn().mockResolvedValue([]),
          findMilestones: vi.fn().mockResolvedValue([]),
        },
      }),
    );
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request(
      "http://pages.invalid/projekte/project-1?tab=team",
    );

    const result = await loader({
      context,
      params: { projectId: "project-1" },
      request,
    } as unknown as LoaderFunctionArgs);

    expect(result.eligibleUsers).toEqual([]);
  });

  it("maps inaccessible projects to a 403 response", async () => {
    const { ProjectAccessDeniedError } =
      await import("@/backend/service/ProjectService");
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          getById: vi.fn().mockRejectedValue(new ProjectAccessDeniedError()),
        },
      }),
    );
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request("http://pages.invalid/projekte/project-1");

    await expect(
      loader({
        context,
        params: { projectId: "project-1" },
        request,
      } as unknown as LoaderFunctionArgs),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rethrows unexpected loader failures", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          getById: vi.fn().mockRejectedValue(new Error("Boom")),
        },
      }),
    );
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request("http://pages.invalid/projekte/project-1");

    await expect(
      loader({
        context,
        params: { projectId: "project-1" },
        request,
      } as unknown as LoaderFunctionArgs),
    ).rejects.toThrow("Boom");
  });

  it("maps missing projects to a 404 response", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          getById: vi.fn().mockRejectedValue(new ProjectNotFoundError()),
        },
      }),
    );
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request("http://pages.invalid/projekte/missing");

    await expect(
      loader({
        context,
        params: { projectId: "missing" },
        request,
      } as unknown as LoaderFunctionArgs),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("project detail route action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedServices.mockResolvedValue(createServices());
  });

  it("updates project details", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      description: "Updated description",
      intent: "update-details",
      managerId: "",
      name: "Pages",
      notes: "",
      startDate: "",
      status: "active",
      targetDate: "",
    });

    const result = await action({
      context,
      params: { projectId: "project-1" },
      request,
    } as unknown as LoaderFunctionArgs);

    expect(result).toMatchObject({ data: { ok: true } });
  });

  it("rejects invalid detail input with 400", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      intent: "update-details",
      name: "Pages",
      status: "unknown",
    });

    const result = await action({
      context,
      params: { projectId: "project-1" },
      request,
    } as unknown as LoaderFunctionArgs);

    expect(result).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });
  });

  it("maps management denials to 403", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          getById: vi.fn().mockResolvedValue(createProject()),
          updateDetails: vi
            .fn()
            .mockRejectedValue(new ProjectManagementDeniedError()),
        },
      }),
    );
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      intent: "update-details",
      name: "Pages",
      status: "active",
    });

    const result = await action({
      context,
      params: { projectId: "project-1" },
      request,
    } as unknown as LoaderFunctionArgs);

    expect(result).toMatchObject({
      data: { ok: false },
      init: { status: 403 },
    });
  });

  it("saves the GitHub integration without returning the token", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      intent: "save-integration",
      repoUrl: "https://github.com/user/pages.git",
      syncComments: "on",
      syncDirection: "bidirectional",
      syncIntervalMinutes: "15",
      syncIssues: "on",
      syncStatus: "on",
      token: "ghp-example-token",
    });

    const result = await action({
      context,
      params: { projectId: "project-1" },
      request,
    } as unknown as LoaderFunctionArgs);

    expect(result).toMatchObject({ data: { ok: true } });

    const pushResult = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        intent: "save-integration",
        repoUrl: "https://github.com/user/pages.git",
        syncDirection: "push",
        syncIntervalMinutes: "0",
        token: "",
      }),
    } as unknown as LoaderFunctionArgs);

    expect(pushResult).toMatchObject({ data: { ok: true } });

    const invalidInterval = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        intent: "save-integration",
        repoUrl: "https://github.com/user/pages.git",
        syncIntervalMinutes: "42",
        token: "",
      }),
    } as unknown as LoaderFunctionArgs);

    expect(invalidInterval).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });
  });

  it("rejects non-POST and unauthenticated mutations", async () => {
    const authenticated = new Map([[authenticatedUserContext, createUser()]]);
    const getRequest = new Request("http://pages.invalid/projekte/project-1", {
      method: "GET",
    });

    await expect(
      action({
        context: authenticated,
        params: { projectId: "project-1" },
        request: getRequest,
      } as unknown as LoaderFunctionArgs),
    ).rejects.toMatchObject({ status: 405 });

    const postRequest = createPostRequest({ intent: "save-integration" });

    await expect(
      action({
        context: new Map(),
        params: { projectId: "project-1" },
        request: postRequest,
      } as unknown as LoaderFunctionArgs),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("maps service failures to action errors", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const valid = {
      intent: "update-details",
      name: "Pages",
      status: "active",
    };

    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          getById: vi.fn().mockResolvedValue(createProject()),
          updateDetails: vi.fn().mockRejectedValue(new ProjectNotFoundError()),
        },
      }),
    );

    const notFound = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest(valid),
    } as unknown as LoaderFunctionArgs);
    expect(notFound).toMatchObject({
      data: { ok: false },
      init: { status: 404 },
    });

    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          getById: vi.fn().mockResolvedValue(createProject()),
          updateDetails: vi.fn().mockRejectedValue(new Error("Boom")),
        },
      }),
    );

    const invalid = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest(valid),
    } as unknown as LoaderFunctionArgs);
    expect(invalid).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });

    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          getById: vi.fn().mockResolvedValue(createProject()),
          updateDetails: vi
            .fn()
            .mockRejectedValue(new WorkItemValidationError("Bad")),
        },
      }),
    );

    const validation = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest(valid),
    } as unknown as LoaderFunctionArgs);
    expect(validation).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });
  });

  it("manages goals through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const services = createServices();
    vi.mocked(services.projectService.findGoals).mockResolvedValue([
      { id: "goal-1", isDone: false, title: "Ship MVP" },
    ] as never);
    mockedServices.mockResolvedValue(services);

    const created = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ intent: "create-goal", title: "Ship MVP" }),
    } as unknown as LoaderFunctionArgs);
    expect(created).toMatchObject({ data: { ok: true } });

    const toggled = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ goalId: "goal-1", intent: "toggle-goal" }),
    } as unknown as LoaderFunctionArgs);
    expect(toggled).toMatchObject({ data: { ok: true } });

    const missing = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ goalId: "missing", intent: "toggle-goal" }),
    } as unknown as LoaderFunctionArgs);
    expect(missing).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });

    const deleted = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ goalId: "goal-1", intent: "delete-goal" }),
    } as unknown as LoaderFunctionArgs);
    expect(deleted).toMatchObject({ data: { ok: true } });

    const tagged = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ intent: "set-tags", tags: "Web, Intern" }),
    } as unknown as LoaderFunctionArgs);
    expect(tagged).toMatchObject({ data: { ok: true } });
  });

  it("manages team memberships through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const added = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        intent: "add-member",
        role: "member",
        userId: "user-2",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(added).toMatchObject({ data: { ok: true } });

    const invalidRole = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        intent: "add-member",
        role: "superadmin",
        userId: "user-2",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(invalidRole).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });

    const roleUpdated = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        intent: "update-member-role",
        role: "viewer",
        userId: "user-2",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(roleUpdated).toMatchObject({ data: { ok: true } });

    const invalidUpdate = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        intent: "update-member-role",
        role: "superadmin",
        userId: "user-2",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(invalidUpdate).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });

    const removed = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ intent: "remove-member", userId: "user-2" }),
    } as unknown as LoaderFunctionArgs);
    expect(removed).toMatchObject({ data: { ok: true } });
  });

  it("manages milestones through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const created = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        description: "First release",
        dueAt: "2026-09-30",
        intent: "create-milestone",
        name: "MVP",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(created).toMatchObject({ data: { ok: true } });

    const createdWithoutDate = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        intent: "create-milestone",
        name: "Backlog item",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(createdWithoutDate).toMatchObject({ data: { ok: true } });

    const updated = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        intent: "update-milestone-status",
        milestoneId: "milestone-1",
        status: "completed",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(updated).toMatchObject({ data: { ok: true } });

    const missing = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        intent: "update-milestone-status",
        milestoneId: "missing",
        status: "completed",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(missing).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });

    const invalidStatus = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        intent: "update-milestone-status",
        milestoneId: "milestone-1",
        status: "bogus",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(invalidStatus).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });
  });

  it("manages planning dates through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const created = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        eventDate: "2026-09-30",
        eventTime: "10:00",
        intent: "create-event",
        title: "MVP",
        type: "milestone",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(created).toMatchObject({ data: { ok: true } });

    const createdMinimal = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        eventDate: "2026-10-01",
        intent: "create-event",
        title: "Kickoff",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(createdMinimal).toMatchObject({ data: { ok: true } });

    const archived = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({
        eventId: "event-1",
        intent: "archive-event",
      }),
    } as unknown as LoaderFunctionArgs);
    expect(archived).toMatchObject({ data: { ok: true } });
  });

  it("tests, syncs, and disconnects integrations through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const tested = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ intent: "test-integration" }),
    } as unknown as LoaderFunctionArgs);
    expect(tested).toMatchObject({ data: { ok: true } });

    mockedServices.mockResolvedValue(
      createServices({
        gitHubSyncService: {
          testConnection: vi.fn().mockResolvedValue(false),
        },
      }),
    );

    const failed = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ intent: "test-integration" }),
    } as unknown as LoaderFunctionArgs);
    expect(failed).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });

    mockedServices.mockResolvedValue(createServices());

    const synced = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ intent: "sync-integration" }),
    } as unknown as LoaderFunctionArgs);
    expect(synced).toMatchObject({ data: { ok: true } });

    const disconnected = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ intent: "disconnect-integration" }),
    } as unknown as LoaderFunctionArgs);
    expect(disconnected).toMatchObject({ data: { ok: true } });

    const unknown = await action({
      context,
      params: { projectId: "project-1" },
      request: createPostRequest({ intent: "bogus-intent" }),
    } as unknown as LoaderFunctionArgs);
    expect(unknown).toMatchObject({
      data: { ok: false },
      init: { status: 400 },
    });
  });

  it("rethrows unexpected action failures", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        projectService: {
          getById: vi.fn().mockResolvedValue(createProject()),
          updateDetails: vi.fn().mockRejectedValue("boom-string"),
        },
      }),
    );
    const context = new Map([[authenticatedUserContext, createUser()]]);

    await expect(
      action({
        context,
        params: { projectId: "project-1" },
        request: createPostRequest({
          intent: "update-details",
          name: "Pages",
          status: "active",
        }),
      } as unknown as LoaderFunctionArgs),
    ).rejects.toBe("boom-string");
  });
});
