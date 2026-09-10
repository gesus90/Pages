import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { action, loader, parseDetailView } from "@/app/routes/task-detail";
import { ProjectAccessDeniedError } from "@/backend/service/ProjectService";
import {
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/service/TaskService";
import { ROLE } from "@/definition/Role";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import type { Project } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

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

function createTicket(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeId: "user-1",
    assigneeName: "Admin",
    reporterName: "Alex Berger",
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "Details",
    dueAt: "2026-09-30",
    githubConflict: false,
    githubContentHash: null,
    githubIssueNumber: null,
    githubIssueState: null,
    githubIssueUpdatedAt: null,
    githubIssueUrl: null,
    githubLastError: null,
    githubLastSyncAt: null,
    id: "item-14",
    isDone: false,
    key: "PAGE-14",
    milestoneId: null,
    milestoneName: null,
    number: 14,
    parentId: null,
    parentKey: null,
    parentTitle: null,
    priority: WORK_ITEM_PRIORITY.HIGH,
    progressPercentage: 0,
    projectId: "project-1",
    projectName: "Pages",
    sortOrder: 14,
    startAt: null,
    statusId: "status-todo",
    statusKey: "todo",
    statusName: "To Do",
    subtaskCompleted: 0,
    subtaskTotal: 0,
    title: "Login Seite erstellen",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function createServices(
  overrides: Record<string, unknown> = {},
): Awaited<ReturnType<typeof mockedServices>> {
  return {
    gitHubSyncService: {
      findPullRequestsForTask: vi.fn().mockResolvedValue([]),
    },
    projectService: {
      findAll: vi.fn().mockResolvedValue([createProject()]),
      getById: vi.fn().mockResolvedValue(createProject()),
    },
    taskService: {
      archive: vi.fn(),
      assignLabel: vi.fn(),
      countLabelUsage: vi.fn().mockResolvedValue(new Map()),
      create: vi.fn(),
      createLabel: vi.fn(),
      deleteLabel: vi.fn(),
      findAll: vi.fn().mockResolvedValue([]),
      findAllStatuses: vi.fn().mockResolvedValue([]),
      findEligibleAssignees: vi.fn().mockResolvedValue([createUser()]),
      findLabels: vi.fn().mockResolvedValue([]),
      findLabelsForWorkItems: vi.fn().mockResolvedValue(new Map()),
      findMilestones: vi.fn().mockResolvedValue([]),
      findSubtasks: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockResolvedValue(createTicket()),
      getByKey: vi.fn().mockResolvedValue(createTicket()),
      getHistory: vi.fn().mockResolvedValue([]),
      moveToProject: vi.fn(),
      restore: vi.fn(),
      unassignLabel: vi.fn(),
      update: vi.fn(),
      updateLabel: vi.fn(),
      updateStatusAndOrder: vi.fn(),
    },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof mockedServices>>;
}

function createLoaderArgs(
  ticketKey?: string,
  from?: string,
): LoaderFunctionArgs {
  const url = `http://pages.invalid/aufgaben${ticketKey ? `/${ticketKey}` : ""}${from ? `?from=${from}` : ""}`;

  return {
    context: new Map([[authenticatedUserContext, createUser()]]),
    params: ticketKey ? { ticketKey } : {},
    request: new Request(url),
  } as unknown as LoaderFunctionArgs;
}

describe("task detail route action", () => {
  it("reuses the shared task board action", async () => {
    const services = createServices();
    mockedServices.mockResolvedValue(services);

    const formData = new URLSearchParams();
    formData.append("intent", "archive-task");
    formData.append("id", "item-14");

    const response = (await action({
      context: new Map([[authenticatedUserContext, createUser()]]),
      request: new Request("http://pages.invalid/aufgaben/PAGE-14", {
        body: formData,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
    } as unknown as ActionFunctionArgs)) as unknown as {
      data: Record<string, unknown>;
    };

    expect(response.data).toMatchObject({ intent: "archive-task", ok: true });
    expect(services.taskService.archive).toHaveBeenCalledWith(
      expect.anything(),
      "item-14",
    );
  });
});

describe("parseDetailView", () => {
  it("parses board views with a kanban default", () => {
    expect(parseDetailView("kanban")).toBe("kanban");
    expect(parseDetailView("list")).toBe("list");
    expect(parseDetailView("hierarchy")).toBe("hierarchy");
    expect(parseDetailView("milestones")).toBe("milestones");
    expect(parseDetailView("github")).toBe("github");
    expect(parseDetailView("board")).toBe("kanban");
    expect(parseDetailView(null)).toBe("kanban");
  });
});

describe("task detail route loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedServices.mockResolvedValue(createServices());
  });

  it("throws without an authenticated user", async () => {
    await expect(
      loader({
        context: new Map(),
        params: { ticketKey: "PAGE-14" },
        request: new Request("http://pages.invalid/aufgaben/PAGE-14"),
      } as unknown as LoaderFunctionArgs),
    ).rejects.toThrow("Authenticated middleware did not provide a user.");
  });

  it("answers missing ticket keys with 404", async () => {
    await expect(
      loader({
        context: new Map([[authenticatedUserContext, createUser()]]),
        params: {},
        request: new Request("http://pages.invalid/aufgaben"),
      } as unknown as LoaderFunctionArgs),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("answers unknown tickets with 404 and rethrows failures", async () => {
    const services = createServices();
    (
      services.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemNotFoundError());
    mockedServices.mockResolvedValueOnce(services);

    await expect(loader(createLoaderArgs("PAGE-99"))).rejects.toMatchObject({
      status: 404,
    });

    const failing = createServices();
    (
      failing.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Database gone"));
    mockedServices.mockResolvedValueOnce(failing);

    await expect(loader(createLoaderArgs("PAGE-14"))).rejects.toThrow(
      "Database gone",
    );
  });

  it("loads tickets with parent, children, and labels", async () => {
    const services = createServices();
    const parent = createTicket({
      id: "epic-1",
      key: "PAGE-3",
      title: "Projektverwaltung",
      type: WORK_ITEM_TYPE.EPIC,
    });
    const child = createTicket({
      id: "sub-1",
      key: "PAGE-14.1",
      parentId: "item-14",
      title: "UI erstellen",
      type: WORK_ITEM_TYPE.SUBTASK,
    });
    const ticket = createTicket({ parentId: "epic-1" });
    (
      services.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockResolvedValue(ticket);
    (
      services.taskService.getById as ReturnType<typeof vi.fn>
    ).mockResolvedValue(parent);
    (
      services.taskService.findSubtasks as ReturnType<typeof vi.fn>
    ).mockResolvedValue([child]);
    (
      services.taskService.findLabelsForWorkItems as ReturnType<typeof vi.fn>
    ).mockResolvedValue(new Map([["item-14", []]]));
    mockedServices.mockResolvedValue(services);

    const result = await loader(createLoaderArgs("PAGE-14", "list"));

    expect(result.ticket.key).toBe("PAGE-14");
    expect(result.parent?.key).toBe("PAGE-3");
    expect(result.children).toHaveLength(1);
    expect(result.fromView).toBe("list");
    expect(result.taskLabels).toEqual([]);
  });

  it("hides inaccessible parents instead of failing", async () => {
    const services = createServices();
    (
      services.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createTicket({ parentId: "epic-1" }));
    (
      services.taskService.getById as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new ProjectAccessDeniedError());
    mockedServices.mockResolvedValue(services);

    const denied = await loader(createLoaderArgs("PAGE-14"));
    expect(denied.parent).toBeNull();
    expect(denied.fromView).toBe("kanban");

    const missingParent = createServices();
    (
      missingParent.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createTicket({ parentId: "epic-1" }));
    (
      missingParent.taskService.getById as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemNotFoundError());
    mockedServices.mockResolvedValueOnce(missingParent);

    const missing = await loader(createLoaderArgs("PAGE-14"));
    expect(missing.parent).toBeNull();

    const failingParent = createServices();
    (
      failingParent.taskService.getByKey as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createTicket({ parentId: "epic-1" }));
    (
      failingParent.taskService.getById as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Database gone"));
    mockedServices.mockResolvedValueOnce(failingParent);

    await expect(loader(createLoaderArgs("PAGE-14"))).rejects.toThrow(
      "Database gone",
    );
  });

  it("loads parentless tickets without parent lookups", async () => {
    const services = createServices();
    const getById = services.taskService.getById as ReturnType<typeof vi.fn>;
    mockedServices.mockResolvedValue(services);

    const result = await loader(createLoaderArgs("PAGE-14"));

    expect(result.parent).toBeNull();
    expect(getById).not.toHaveBeenCalled();
  });

  it("rejects label validation failures through the shared action", async () => {
    const services = createServices();
    (
      services.taskService.createLabel as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new WorkItemValidationError("Nope"));
    mockedServices.mockResolvedValue(services);

    const formData = new URLSearchParams();
    formData.append("intent", "label-create");
    formData.append("projectId", "project-1");
    formData.append("name", "Bug");
    formData.append("color", "#ef4444");

    const response = (await action({
      context: new Map([[authenticatedUserContext, createUser()]]),
      request: new Request("http://pages.invalid/aufgaben/PAGE-14", {
        body: formData,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
    } as unknown as ActionFunctionArgs)) as unknown as {
      data: Record<string, unknown>;
      init?: { status?: number };
    };

    expect(response.init?.status).toBe(400);
  });
});
