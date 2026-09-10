import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  action,
  loader,
  parseArchivedFilter,
  parseViewMode,
} from "@/app/routes/tasks";
import { GitHubApiError } from "@/backend/github/GitHubApiClient";
import {
  WorkItemAccessDeniedError,
  WorkItemHierarchyError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/service/TaskService";
import { ROLE } from "@/definition/Role";
import {
  WORK_ITEM_LINK_TYPE,
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";
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

function createStatus(): WorkflowStatus {
  return {
    id: "status-todo",
    isDone: false,
    key: WORKFLOW_STATUS_KEY.TODO,
    name: "To Do",
    position: 1,
    projectId: null,
  };
}

function createMilestone(): Milestone {
  return {
    archivedAt: null,
    completedAt: null,
    createdAt: "2026-01-01",
    description: "Milestone v1",
    dueAt: "2026-05-01",
    id: "milestone-1",
    name: "v1.0",
    projectId: "project-1",
    startAt: "2026-01-01",
    status: "open",
    updatedAt: "2026-01-02",
  };
}

function createWorkItem(
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeId: "user-1",
    assigneeName: "Admin",
    reporterName: "Reporter",
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "Details",
    dueAt: "2026-04-01",
    githubConflict: false,
    githubContentHash: null,
    githubIssueNumber: null,
    githubIssueState: null,
    githubIssueUpdatedAt: null,
    githubIssueUrl: null,
    githubLastSyncAt: null,
    githubLastError: null,
    id: "item-1",
    isDone: false,
    key: "PAGE-12",
    milestoneId: "milestone-1",
    milestoneName: "v1.0",
    number: 12,
    parentId: null,
    parentKey: null,
    parentTitle: null,
    priority: WORK_ITEM_PRIORITY.NORMAL,
    progressPercentage: 0,
    projectId: "project-1",
    projectName: "Pages",
    sortOrder: 1,
    startAt: null,
    statusId: "status-todo",
    statusKey: "todo",
    statusName: "To Do",
    subtaskCompleted: 0,
    subtaskTotal: 0,
    title: "Kanban Task",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function createServices(
  overrides: Record<string, unknown> = {},
): Awaited<ReturnType<typeof mockedServices>> {
  return {
    projectService: {
      findAll: vi.fn().mockResolvedValue([createProject()]),
      findIntegration: vi.fn().mockResolvedValue(null),
      findIntegrationsByProjects: vi.fn().mockResolvedValue(new Map()),
      getById: vi.fn().mockResolvedValue(createProject()),
    },
    taskService: {
      addChecklistItem: vi.fn(),
      addLink: vi.fn(),
      archive: vi.fn(),
      assignLabel: vi.fn(),
      countLabelUsage: vi.fn().mockResolvedValue(new Map()),
      countLabelUsageByProjects: vi
        .fn()
        .mockResolvedValue(new Map([["project-1", new Map()]])),
      create: vi.fn().mockResolvedValue(createWorkItem()),
      createLabel: vi.fn(),
      deleteChecklistItem: vi.fn(),
      deleteLabel: vi.fn(),
      findAll: vi.fn().mockResolvedValue([createWorkItem()]),
      findAllStatuses: vi.fn().mockResolvedValue([createStatus()]),
      findAssigneesByProjects: vi
        .fn()
        .mockResolvedValue(new Map([["project-1", [createUser()]]])),
      findChecklistItems: vi.fn().mockResolvedValue([]),
      findEligibleAssignees: vi.fn().mockResolvedValue([createUser()]),
      findLabels: vi.fn().mockResolvedValue([]),
      findLabelsByProjects: vi
        .fn()
        .mockResolvedValue(new Map([["project-1", []]])),
      findLabelsForWorkItems: vi
        .fn()
        .mockResolvedValue(new Map([["item-1", []]])),
      findLinks: vi.fn().mockResolvedValue([]),
      findMilestones: vi.fn().mockResolvedValue([createMilestone()]),
      findSubtasks: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockResolvedValue(createWorkItem()),
      getByKey: vi.fn().mockResolvedValue(createWorkItem()),
      getHistory: vi.fn().mockResolvedValue([]),
      moveToProject: vi.fn().mockResolvedValue(createWorkItem()),
      removeLink: vi.fn(),
      restore: vi.fn(),
      setChecklistItemDone: vi.fn(),
      unassignLabel: vi.fn(),
      update: vi.fn().mockResolvedValue(createWorkItem()),
      updateLabel: vi.fn(),
      updateStatusAndOrder: vi.fn().mockResolvedValue(createWorkItem()),
    },
    gitHubSyncService: {
      assignPullRequest: vi.fn(),
      dismissExternalIssue: vi.fn(),
      findExternalIssues: vi.fn().mockResolvedValue([]),
      findExternalIssuesByProjects: vi.fn().mockResolvedValue(new Map()),
      findPullRequests: vi.fn().mockResolvedValue([]),
      findPullRequestsByProjects: vi.fn().mockResolvedValue(new Map()),
      findPullRequestsForTask: vi.fn().mockResolvedValue([]),
      importExternalIssue: vi.fn().mockResolvedValue(createWorkItem()),
      linkExternalIssue: vi.fn().mockResolvedValue(createWorkItem()),
      resolveConflict: vi.fn().mockResolvedValue(createWorkItem()),
      syncProjectNow: vi.fn(),
      syncSingleTask: vi.fn(),
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

  return new Request("http://pages.invalid/aufgaben", {
    body: formData,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

function getActionData(result: unknown): {
  data: Record<string, unknown>;
  init?: { status?: number };
} {
  return result as {
    data: Record<string, unknown>;
    init?: { status?: number };
  };
}

describe("tasks route loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedServices.mockResolvedValue(createServices());
  });

  it("throws when authenticated middleware did not provide a user", async () => {
    const context = new Map();
    const request = new Request("http://pages.invalid/aufgaben");

    await expect(
      loader({ context, request } as unknown as LoaderFunctionArgs),
    ).rejects.toThrow("Authenticated middleware did not provide a user.");
  });

  it("loads work items, projects, statuses, and milestones for SSR", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request("http://pages.invalid/aufgaben");

    const result = await loader({
      context,
      request,
    } as unknown as LoaderFunctionArgs);

    expect(result.projects).toHaveLength(1);
    expect(result.statuses).toHaveLength(1);
    expect(result.workItems).toHaveLength(1);
    expect(result.assignees).toHaveLength(1);
    expect(result.selectedItem).toBeNull();
  });

  it("loads deep-linked task item with subtasks and history", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request(
      "http://pages.invalid/aufgaben?item=PAGE-12&view=github",
    );

    const result = await loader({
      context,
      request,
    } as unknown as LoaderFunctionArgs);

    expect(result.selectedItem).not.toBeNull();
    expect(result.selectedItem?.key).toBe("PAGE-12");
    expect(result.selectedPullRequests).toEqual([]);
    expect(result.githubStates).toHaveLength(1);
    expect(result.githubStates[0]?.project.id).toBe("project-1");
  });
});

describe("tasks route action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedServices.mockResolvedValue(createServices());
  });

  it("rejects non-POST requests with 405", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = new Request("http://pages.invalid/aufgaben", {
      method: "GET",
    });

    await expect(
      action({ context, request } as unknown as LoaderFunctionArgs),
    ).rejects.toThrow();
  });

  it("rejects unauthenticated requests with 403", async () => {
    const context = new Map();
    const request = new Request("http://pages.invalid/aufgaben", {
      method: "POST",
    });

    await expect(
      action({ context, request } as unknown as LoaderFunctionArgs),
    ).rejects.toThrow();
  });

  it("creates a task successfully", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      description: "Description",
      intent: "create-task",
      priority: WORK_ITEM_PRIORITY.HIGH,
      projectId: "project-1",
      statusId: "status-todo",
      title: "New Task",
      type: WORK_ITEM_TYPE.TASK,
    });

    const response = getActionData(
      await action({
        context,
        request,
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.data).toMatchObject({
      intent: "create-task",
      key: "PAGE-12",
      ok: true,
    });
  });

  it("returns 400 on invalid input for create-task", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      intent: "create-task",
      projectId: "project-1",
    });

    const response = getActionData(
      await action({
        context,
        request,
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.init?.status).toBe(400);
  });

  it("updates a task successfully", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      description: "Updated desc",
      id: "item-1",
      intent: "update-task",
      priority: WORK_ITEM_PRIORITY.NORMAL,
      reporterId: "user-1",
      statusId: "status-todo",
      title: "Updated Task",
    });

    const response = getActionData(
      await action({
        context,
        request,
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.data).toMatchObject({ intent: "update-task", ok: true });
  });

  it("returns 400 on invalid input for update-task", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      id: "item-1",
      intent: "update-task",
    });

    const response = getActionData(
      await action({
        context,
        request,
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.init?.status).toBe(400);
  });

  it("parses archived filters and board views", () => {
    expect(parseArchivedFilter("archived")).toBe("archived");
    expect(parseArchivedFilter("all")).toBe("all");
    expect(parseArchivedFilter("active")).toBe("active");
    expect(parseArchivedFilter(null)).toBe("active");
    expect(parseViewMode("kanban")).toBe("kanban");
    expect(parseViewMode("list")).toBe("list");
    expect(parseViewMode("hierarchy")).toBe("hierarchy");
    expect(parseViewMode("milestones")).toBe("milestones");
    expect(parseViewMode("github")).toBe("github");
    expect(parseViewMode("board")).toBe("kanban");
    expect(parseViewMode(null)).toBe("kanban");
  });

  it("loads archived tickets when requested", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const services = createServices();
    mockedServices.mockResolvedValue(services);

    await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben?archived=archived"),
    } as unknown as LoaderFunctionArgs);

    expect(services.taskService.findAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ archived: "archived" }),
    );

    await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben?archived=all"),
    } as unknown as LoaderFunctionArgs);

    expect(services.taskService.findAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ archived: "all" }),
    );
  });

  it("loads empty boards without label lookups", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const services = createServices();
    (
      services.taskService.findAll as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    mockedServices.mockResolvedValue(services);

    const result = await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben"),
    } as unknown as LoaderFunctionArgs);

    expect(result.workItems).toEqual([]);
    expect(result.labelsByWorkItem).toEqual({});
    expect(services.taskService.findLabelsForWorkItems).not.toHaveBeenCalled();
  });

  it("resolves selected tickets outside the board filter", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const services = createServices();
    (
      services.taskService.findAll as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    (
      services.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createWorkItem());
    mockedServices.mockResolvedValue(services);

    const found = await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben?item=PAGE-12"),
    } as unknown as LoaderFunctionArgs);

    expect(found.selectedItem?.key).toBe("PAGE-12");

    (
      services.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemNotFoundError());
    const missing = await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben?item=PAGE-99"),
    } as unknown as LoaderFunctionArgs);
    expect(missing.selectedItem).toBeNull();

    const { ProjectAccessDeniedError } =
      await import("@/backend/service/ProjectService");
    (
      services.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new ProjectAccessDeniedError());
    const denied = await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben?item=PAGE-12"),
    } as unknown as LoaderFunctionArgs);
    expect(denied.selectedItem).toBeNull();

    (
      services.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Database gone"));
    await expect(
      loader({
        context,
        request: new Request("http://pages.invalid/aufgaben?item=PAGE-12"),
      } as unknown as LoaderFunctionArgs),
    ).rejects.toThrow("Database gone");
  });

  it("moves a task via drag and drop", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      id: "item-1",
      intent: "move-task",
      sortOrder: "3",
      statusId: "status-done",
    });

    const response = getActionData(
      await action({
        context,
        request,
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.data).toMatchObject({ intent: "move-task", ok: true });
  });

  it("returns 400 on invalid input for move-task", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      intent: "move-task",
    });

    const response = getActionData(
      await action({
        context,
        request,
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.init?.status).toBe(400);
  });

  it("archives a task", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      id: "item-1",
      intent: "archive-task",
    });

    const response = getActionData(
      await action({
        context,
        request,
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.data).toMatchObject({ intent: "archive-task", ok: true });
  });

  it("returns 400 on missing id for archive-task", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({
      intent: "archive-task",
    });

    const response = getActionData(
      await action({
        context,
        request,
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.init?.status).toBe(400);
  });

  it("handles known domain errors with appropriate status codes", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const services = createServices();
    (
      services.taskService.create as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemAccessDeniedError());
    mockedServices.mockResolvedValueOnce(services);

    const deniedResponse = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "create-task",
          projectId: "project-1",
          statusId: "status-todo",
          title: "T",
          type: WORK_ITEM_TYPE.TASK,
        }),
      } as unknown as LoaderFunctionArgs),
    );

    expect(deniedResponse.init?.status).toBe(403);

    (
      services.taskService.create as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemNotFoundError());
    mockedServices.mockResolvedValueOnce(services);

    const notFoundResponse = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "create-task",
          projectId: "project-1",
          statusId: "status-todo",
          title: "T",
          type: WORK_ITEM_TYPE.TASK,
        }),
      } as unknown as LoaderFunctionArgs),
    );

    expect(notFoundResponse.init?.status).toBe(404);

    (
      services.taskService.create as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemHierarchyError("Invalid hierarchy"));
    mockedServices.mockResolvedValueOnce(services);

    const hierarchyResponse = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "create-task",
          projectId: "project-1",
          statusId: "status-todo",
          title: "T",
          type: WORK_ITEM_TYPE.TASK,
        }),
      } as unknown as LoaderFunctionArgs),
    );

    expect(hierarchyResponse.init?.status).toBe(400);
  });

  it("rethrows unexpected service failures", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const services = createServices();
    (
      services.taskService.create as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Database gone"));
    mockedServices.mockResolvedValueOnce(services);

    await expect(
      action({
        context,
        request: createPostRequest({
          intent: "create-task",
          projectId: "project-1",
          statusId: "status-todo",
          title: "T",
          type: WORK_ITEM_TYPE.TASK,
        }),
      } as unknown as LoaderFunctionArgs),
    ).rejects.toThrow("Database gone");
  });

  it("sorts assignees for the creation dialog", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const services = createServices();
    (
      services.taskService.findAssigneesByProjects as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      new Map([
        [
          "project-1",
          [
            createUser({ displayName: "Zed", id: "user-2", username: "zed" }),
            createUser(),
          ],
        ],
      ]),
    );
    mockedServices.mockResolvedValue(services);

    const result = await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben"),
    } as unknown as LoaderFunctionArgs);

    expect(result.assignees.map((user) => user.displayName)).toEqual([
      "Admin",
      "Zed",
    ]);
  });

  it("maps GitHub API failures to sync errors", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const services = createServices();
    (
      services.gitHubSyncService.syncProjectNow as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new GitHubApiError(401, "Bad credentials"));
    mockedServices.mockResolvedValueOnce(services);

    const response = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "sync-github-project",
          projectId: "project-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.data).toMatchObject({
      error: "githubSyncFailed",
      ok: false,
    });
    expect(response.init?.status).toBe(401);

    const lowServices = createServices();
    (
      lowServices.gitHubSyncService.syncProjectNow as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new GitHubApiError(99, "Weird status"));
    mockedServices.mockResolvedValueOnce(lowServices);

    const lowResponse = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "sync-github-project",
          projectId: "project-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(lowResponse.init?.status).toBe(502);

    const highServices = createServices();
    (
      highServices.gitHubSyncService.syncProjectNow as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new GitHubApiError(700, "Weird status"));
    mockedServices.mockResolvedValueOnce(highServices);

    const highResponse = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "sync-github-project",
          projectId: "project-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(highResponse.init?.status).toBe(502);
  });

  it("creates and updates tasks with minimal forms", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const created = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "create-task",
          projectId: "project-1",
          statusId: "status-todo",
          title: "Minimal Task",
          type: WORK_ITEM_TYPE.TASK,
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(created.data).toMatchObject({ intent: "create-task", ok: true });

    const updated = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "item-1",
          intent: "update-task",
          priority: WORK_ITEM_PRIORITY.NORMAL,
          reporterId: "user-1",
          statusId: "status-todo",
          title: "Minimal Update",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(updated.data).toMatchObject({ intent: "update-task", ok: true });
  });

  it("matches deep-linked items by id and ignores unknown keys", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const services = createServices();
    (
      services.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new WorkItemNotFoundError());
    mockedServices.mockResolvedValue(services);

    const byId = await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben?item=item-1"),
    } as unknown as LoaderFunctionArgs);
    expect(byId.selectedItem?.id).toBe("item-1");

    const unknown = await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben?item=UNKNOWN-9"),
    } as unknown as LoaderFunctionArgs);
    expect(unknown.selectedItem).toBeNull();
  });

  it("rejects unknown action intents", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const request = createPostRequest({ intent: "unknown-intent" });

    const response = getActionData(
      await action({
        context,
        request,
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.data).toMatchObject({ error: "invalidInput", ok: false });
    expect(response.init?.status).toBe(400);
  });

  it("clears pull request assignments with empty selections", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const cleared = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "github-assign-pr",
          pullRequestId: "pr-1",
          workItemId: "",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(cleared.data).toMatchObject({
      intent: "github-assign-pr",
      ok: true,
    });
  });

  it("synchronizes projects and single tasks through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const projectResponse = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "sync-github-project",
          projectId: "project-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(projectResponse.data).toMatchObject({
      intent: "sync-github-project",
      ok: true,
    });

    const taskResponse = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "item-1",
          intent: "sync-github-task",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(taskResponse.data).toMatchObject({
      intent: "sync-github-task",
      ok: true,
    });

    const missingProject = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "sync-github-project" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(missingProject.init?.status).toBe(400);

    const missingTask = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "sync-github-task" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(missingTask.init?.status).toBe(400);
  });

  it("imports, links, and dismisses external issues through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const imported = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "github-import-issue",
          issueNumber: "104",
          projectId: "project-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(imported.data).toMatchObject({
      intent: "github-import-issue",
      ok: true,
    });

    const invalidImport = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "github-import-issue",
          issueNumber: "zero",
          projectId: "project-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidImport.init?.status).toBe(400);

    const linked = getActionData(
      await action({
        context,
        request: createPostRequest({
          externalId: "external-104",
          intent: "github-link-issue",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(linked.data).toMatchObject({
      intent: "github-link-issue",
      ok: true,
    });

    const invalidLink = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "github-link-issue" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidLink.init?.status).toBe(400);

    const dismissed = getActionData(
      await action({
        context,
        request: createPostRequest({
          externalId: "external-104",
          intent: "github-dismiss-issue",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(dismissed.data).toMatchObject({
      intent: "github-dismiss-issue",
      ok: true,
    });

    const invalidDismiss = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "github-dismiss-issue" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidDismiss.init?.status).toBe(400);
  });

  it("maps dismissal failures to action errors", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const services = createServices();
    (
      services.gitHubSyncService.dismissExternalIssue as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(services);

    const response = getActionData(
      await action({
        context,
        request: createPostRequest({
          externalId: "external-104",
          intent: "github-dismiss-issue",
        }),
      } as unknown as LoaderFunctionArgs),
    );

    expect(response.data).toMatchObject({ error: "Nope", ok: false });
    expect(response.init?.status).toBe(400);
  });

  it("assigns pull requests and resolves conflicts through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const assigned = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "github-assign-pr",
          pullRequestId: "pr-1",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(assigned.data).toMatchObject({
      intent: "github-assign-pr",
      ok: true,
    });

    const cleared = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "github-assign-pr",
          pullRequestId: "pr-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(cleared.data).toMatchObject({
      intent: "github-assign-pr",
      ok: true,
    });

    const invalidAssign = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "github-assign-pr" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidAssign.init?.status).toBe(400);

    const resolved = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "item-1",
          intent: "github-resolve-conflict",
          resolution: "pages",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(resolved.data).toMatchObject({
      intent: "github-resolve-conflict",
      ok: true,
    });

    const invalidResolution = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "item-1",
          intent: "github-resolve-conflict",
          resolution: "remote",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidResolution.init?.status).toBe(400);
  });

  it("maps pull request and conflict failures to action errors", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const assignServices = createServices();
    (
      assignServices.gitHubSyncService.assignPullRequest as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(assignServices);

    const assignFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "github-assign-pr",
          pullRequestId: "pr-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(assignFailure.data).toMatchObject({
      intent: "github-assign-pr",
      ok: false,
    });
    expect(assignFailure.init?.status).toBe(400);

    const conflictServices = createServices();
    (
      conflictServices.gitHubSyncService.resolveConflict as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new GitHubApiError(403, "Forbidden"));
    mockedServices.mockResolvedValueOnce(conflictServices);

    const conflictFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "item-1",
          intent: "github-resolve-conflict",
          resolution: "pages",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(conflictFailure.data).toMatchObject({
      intent: "github-resolve-conflict",
      ok: false,
    });
    expect(conflictFailure.init?.status).toBe(403);
  });

  it("maps external issue failures to action errors", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const importServices = createServices();
    (
      importServices.gitHubSyncService.importExternalIssue as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(importServices);

    const importFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "github-import-issue",
          issueNumber: "82",
          projectId: "project-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(importFailure.data).toMatchObject({
      intent: "github-import-issue",
      ok: false,
    });
    expect(importFailure.init?.status).toBe(400);

    const linkServices = createServices();
    (
      linkServices.gitHubSyncService.linkExternalIssue as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(linkServices);

    const linkFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          externalId: "external-1",
          intent: "github-link-issue",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(linkFailure.data).toMatchObject({
      intent: "github-link-issue",
      ok: false,
    });
    expect(linkFailure.init?.status).toBe(400);
  });

  it("maps archive and single-task sync failures to action errors", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const archiveServices = createServices();
    (
      archiveServices.taskService.archive as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemNotFoundError());
    mockedServices.mockResolvedValueOnce(archiveServices);

    const archiveFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "item-1",
          intent: "archive-task",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(archiveFailure.data).toMatchObject({
      intent: "archive-task",
      ok: false,
    });
    expect(archiveFailure.init?.status).toBe(404);

    const syncServices = createServices();
    (
      syncServices.gitHubSyncService.syncSingleTask as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new GitHubApiError(403, "Forbidden"));
    mockedServices.mockResolvedValueOnce(syncServices);

    const syncFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "item-1",
          intent: "sync-github-task",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(syncFailure.data).toMatchObject({
      intent: "sync-github-task",
      ok: false,
    });
    expect(syncFailure.init?.status).toBe(403);
  });

  it("maps quick-edit update and move failures to action errors", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const updateServices = createServices();
    (
      updateServices.taskService.update as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemValidationError("Bad"));
    mockedServices.mockResolvedValueOnce(updateServices);

    const updateFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "item-1",
          intent: "update-task",
          priority: WORK_ITEM_PRIORITY.NORMAL,
          reporterId: "user-1",
          statusId: "status-todo",
          title: "Same title",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(updateFailure.data).toMatchObject({
      intent: "update-task",
      ok: false,
    });
    expect(updateFailure.init?.status).toBe(400);

    const moveServices = createServices();
    (
      moveServices.taskService.updateStatusAndOrder as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemNotFoundError());
    mockedServices.mockResolvedValueOnce(moveServices);

    const moveFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "missing",
          intent: "move-task",
          sortOrder: "1",
          statusId: "status-done",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(moveFailure.data).toMatchObject({
      intent: "move-task",
      ok: false,
    });
    expect(moveFailure.init?.status).toBe(404);
  });

  it("restores archived tickets through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const restored = getActionData(
      await action({
        context,
        request: createPostRequest({ id: "item-1", intent: "restore-task" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(restored.data).toMatchObject({ intent: "restore-task", ok: true });

    const invalid = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "restore-task" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalid.init?.status).toBe(400);

    const services = createServices();
    (
      services.taskService.restore as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemNotFoundError());
    mockedServices.mockResolvedValueOnce(services);

    const missing = getActionData(
      await action({
        context,
        request: createPostRequest({ id: "missing", intent: "restore-task" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(missing.init?.status).toBe(404);
  });

  it("moves tickets to another project through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const moved = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "item-1",
          intent: "move-project",
          targetProjectId: "project-2",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(moved.data).toMatchObject({
      intent: "move-project",
      key: "PAGE-12",
      ok: true,
    });

    const invalid = getActionData(
      await action({
        context,
        request: createPostRequest({ id: "item-1", intent: "move-project" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalid.init?.status).toBe(400);

    const services = createServices();
    (
      services.taskService.moveToProject as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemAccessDeniedError());
    mockedServices.mockResolvedValueOnce(services);

    const denied = getActionData(
      await action({
        context,
        request: createPostRequest({
          id: "item-1",
          intent: "move-project",
          targetProjectId: "project-2",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(denied.init?.status).toBe(403);
  });

  it("manages project labels through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const created = getActionData(
      await action({
        context,
        request: createPostRequest({
          color: "#ef4444",
          intent: "label-create",
          name: "Bug",
          projectId: "project-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(created.data).toMatchObject({ intent: "label-create", ok: true });

    const invalidCreate = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "label-create",
          name: "Bug",
          projectId: "project-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidCreate.init?.status).toBe(400);

    const createServicesWithError = createServices();
    (
      createServicesWithError.taskService.createLabel as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(createServicesWithError);

    const failedCreate = getActionData(
      await action({
        context,
        request: createPostRequest({
          color: "#ef4444",
          intent: "label-create",
          name: "Bug",
          projectId: "project-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(failedCreate.init?.status).toBe(400);

    const updated = getActionData(
      await action({
        context,
        request: createPostRequest({
          color: "#a855f7",
          intent: "label-update",
          labelId: "label-1",
          name: "Bugfix",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(updated.data).toMatchObject({ intent: "label-update", ok: true });

    const invalidUpdate = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "label-update",
          labelId: "label-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidUpdate.init?.status).toBe(400);

    const updateServicesWithError = createServices();
    (
      updateServicesWithError.taskService.updateLabel as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(updateServicesWithError);

    const failedUpdate = getActionData(
      await action({
        context,
        request: createPostRequest({
          color: "#a855f7",
          intent: "label-update",
          labelId: "label-1",
          name: "Bugfix",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(failedUpdate.init?.status).toBe(400);

    const deleted = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "label-delete",
          labelId: "label-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(deleted.data).toMatchObject({ intent: "label-delete", ok: true });

    const invalidDelete = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "label-delete" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidDelete.init?.status).toBe(400);

    const deleteServicesWithError = createServices();
    (
      deleteServicesWithError.taskService.deleteLabel as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(deleteServicesWithError);

    const failedDelete = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "label-delete",
          labelId: "label-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(failedDelete.init?.status).toBe(400);

    const assigned = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "label-assign",
          labelId: "label-1",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(assigned.data).toMatchObject({ intent: "label-assign", ok: true });

    const invalidAssign = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "label-assign",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidAssign.init?.status).toBe(400);

    const assignServicesWithError = createServices();
    (
      assignServicesWithError.taskService.assignLabel as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(assignServicesWithError);

    const failedAssign = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "label-assign",
          labelId: "label-1",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(failedAssign.init?.status).toBe(400);

    const unassigned = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "label-unassign",
          labelId: "label-1",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(unassigned.data).toMatchObject({
      intent: "label-unassign",
      ok: true,
    });

    const invalidUnassign = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "label-unassign" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidUnassign.init?.status).toBe(400);

    const unassignServicesWithError = createServices();
    (
      unassignServicesWithError.taskService.unassignLabel as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(unassignServicesWithError);

    const failedUnassign = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "label-unassign",
          labelId: "label-1",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(failedUnassign.init?.status).toBe(400);
  });

  it("falls back to empty aggregates for projects without cached data", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const services = createServices();
    (
      services.projectService.findAll as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      createProject(),
      createProject({ id: "project-2", name: "Second" }),
    ]);
    mockedServices.mockResolvedValue(services);

    const result = await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben"),
    } as unknown as LoaderFunctionArgs);

    expect(result.projects).toHaveLength(2);
  });

  it("falls back to empty labels for a selected item missing from the map", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);
    const services = createServices();
    (
      services.taskService.findAll as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    (
      services.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createWorkItem({ id: "item-99", key: "PAGE-99" }));
    mockedServices.mockResolvedValue(services);

    const result = await loader({
      context,
      request: new Request("http://pages.invalid/aufgaben?item=PAGE-99"),
    } as unknown as LoaderFunctionArgs);

    expect(result.selectedItem?.id).toBe("item-99");
    expect(result.labelsByWorkItem).toEqual({ "item-99": [] });
  });

  it("manages checklist items through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const added = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "checklist-add",
          title: "Write tests",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(added.data).toMatchObject({ intent: "checklist-add", ok: true });

    const invalidAdd = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "checklist-add",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidAdd.init?.status).toBe(400);

    const toggled = getActionData(
      await action({
        context,
        request: createPostRequest({
          checklistItemId: "check-1",
          intent: "checklist-toggle",
          isDone: "true",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(toggled.data).toMatchObject({
      intent: "checklist-toggle",
      ok: true,
    });

    const invalidToggle = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "checklist-toggle" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidToggle.init?.status).toBe(400);

    const deleted = getActionData(
      await action({
        context,
        request: createPostRequest({
          checklistItemId: "check-1",
          intent: "checklist-delete",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(deleted.data).toMatchObject({
      intent: "checklist-delete",
      ok: true,
    });

    const invalidDelete = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "checklist-delete" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidDelete.init?.status).toBe(400);
  });

  it("manages work item links through actions", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const added = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "link-add",
          linkType: WORK_ITEM_LINK_TYPE.RELATES_TO,
          targetKey: "PAGE-13",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(added.data).toMatchObject({ intent: "link-add", ok: true });

    const invalidAdd = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "link-add",
          targetKey: "PAGE-13",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidAdd.init?.status).toBe(400);

    const removed = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "link-remove",
          linkId: "link-1",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(removed.data).toMatchObject({ intent: "link-remove", ok: true });

    const invalidRemove = getActionData(
      await action({
        context,
        request: createPostRequest({ intent: "link-remove" }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(invalidRemove.init?.status).toBe(400);
  });

  it("maps checklist and link failures to action errors", async () => {
    const context = new Map([[authenticatedUserContext, createUser()]]);

    const addChecklistServices = createServices();
    (
      addChecklistServices.taskService.addChecklistItem as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(addChecklistServices);

    const addChecklistFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "checklist-add",
          title: "Write tests",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(addChecklistFailure.init?.status).toBe(400);

    const toggleServices = createServices();
    (
      toggleServices.taskService.setChecklistItemDone as ReturnType<
        typeof vi.fn
      >
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(toggleServices);

    const toggleFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          checklistItemId: "check-1",
          intent: "checklist-toggle",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(toggleFailure.init?.status).toBe(400);

    const deleteServices = createServices();
    (
      deleteServices.taskService.deleteChecklistItem as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemNotFoundError());
    mockedServices.mockResolvedValueOnce(deleteServices);

    const deleteFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          checklistItemId: "check-1",
          intent: "checklist-delete",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(deleteFailure.init?.status).toBe(404);

    const addLinkServices = createServices();
    (
      addLinkServices.taskService.addLink as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValueOnce(addLinkServices);

    const addLinkFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "link-add",
          linkType: WORK_ITEM_LINK_TYPE.RELATES_TO,
          targetKey: "PAGE-13",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(addLinkFailure.init?.status).toBe(400);

    const removeServices = createServices();
    (
      removeServices.taskService.removeLink as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemNotFoundError());
    mockedServices.mockResolvedValueOnce(removeServices);

    const removeFailure = getActionData(
      await action({
        context,
        request: createPostRequest({
          intent: "link-remove",
          linkId: "link-1",
          workItemId: "item-1",
        }),
      } as unknown as LoaderFunctionArgs),
    );
    expect(removeFailure.init?.status).toBe(404);
  });
});
