import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { loader } from "@/app/routes/dashboard";
import { ROLE } from "@/definition/Role";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import type { Project } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

const mockedServices = vi.mocked(getApplicationServices);

function createUser(displayName = "Admin"): User {
  return {
    displayName,
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
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

function createWorkItem(
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeId: "user-1",
    assigneeName: "Admin",
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
    githubLastError: null,
    githubLastSyncAt: null,
    id: "item-1",
    isDone: false,
    key: "PAGE-12",
    milestoneId: null,
    milestoneName: null,
    number: 12,
    parentId: null,
    parentKey: null,
    parentTitle: null,
    priority: WORK_ITEM_PRIORITY.NORMAL,
    progressPercentage: 0,
    projectId: "project-1",
    projectName: "Pages",
    reporterName: "Reporter",
    sortOrder: 1,
    startAt: null,
    statusId: "status-todo",
    statusKey: "todo",
    statusName: "To Do",
    subtaskCompleted: 0,
    subtaskTotal: 0,
    title: "Dashboard Task",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function mockServices(): void {
  mockedServices.mockResolvedValue({
    projectService: {
      findAll: vi.fn().mockResolvedValue([createProject()]),
    },
    taskService: {
      countWorkItemsByProject: vi
        .fn()
        .mockResolvedValue(new Map([["project-1", { done: 0, total: 1 }]])),
      countWorkItemsOverview: vi.fn().mockResolvedValue({
        assigned: 1,
        inProgress: 0,
        open: 1,
        openDelta: 1,
        overdue: 1,
        overdueDelta: 0,
      }),
      findAll: vi.fn().mockResolvedValue([createWorkItem()]),
    },
  } as unknown as Awaited<ReturnType<typeof mockedServices>>);
}

describe("dashboard route loader", () => {
  it("returns the display name and current hour", async () => {
    mockServices();
    const context = {
      get: vi.fn().mockReturnValue(createUser("Müller 🚀")),
    };

    const result = await loader({
      context,
      params: {},
      request: new Request("http://pages.invalid/dashboard"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(context.get).toHaveBeenCalledWith(authenticatedUserContext);
    expect(result.displayName).toBe("Müller 🚀");
    expect(Number.isInteger(result.hour)).toBe(true);
    expect(result.hour).toBeGreaterThanOrEqual(0);
    expect(result.hour).toBeLessThanOrEqual(23);
  });

  it("aggregates open tickets and project counts", async () => {
    mockServices();
    const context = {
      get: vi.fn().mockReturnValue(createUser()),
    };

    const result = await loader({
      context,
      params: {},
      request: new Request("http://pages.invalid/dashboard"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(result.openTickets).toBe(1);
    expect(result.projectCount).toBe(1);
    expect(result.myTasks).toHaveLength(1);
    expect(result.projectOverview).toHaveLength(1);
  });

  it("throws when the middleware did not provide a user", async () => {
    const context = {
      get: vi.fn().mockReturnValue(null),
    };

    await expect(
      loader({
        context,
        params: {},
        request: new Request("http://pages.invalid/dashboard"),
      } as unknown as Parameters<typeof loader>[0]),
    ).rejects.toThrow("Authenticated middleware did not provide a user.");
  });

  it("maps rich task, project, and deadline data across every branch", async () => {
    const now = new Date();
    const pad = (part: number): string => String(part).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const projects = [
      createProject({ id: "project-1", updatedAt: "2026-01-01" }),
      createProject({
        id: "project-2",
        progress: 75,
        updatedAt: "2026-01-03",
      }),
    ];

    const myTaskNoDue = createWorkItem({ dueAt: null });
    const myTaskToday = createWorkItem({
      dueAt: today,
      id: "item-2",
      key: "PAGE-13",
    });
    const deadlineNoDue = createWorkItem({
      dueAt: null,
      id: "item-3",
      key: "PAGE-14",
    });

    mockedServices.mockResolvedValue({
      projectService: {
        findAll: vi.fn().mockResolvedValue(projects),
      },
      taskService: {
        countWorkItemsByProject: vi
          .fn()
          .mockResolvedValue(new Map([["project-1", { done: 0, total: 1 }]])),
        countWorkItemsOverview: vi.fn().mockResolvedValue({
          assigned: 0,
          inProgress: 0,
          open: 0,
          openDelta: 0,
          overdue: 0,
          overdueDelta: 0,
        }),
        findAll: vi.fn().mockImplementation(
          (
            _user: unknown,
            options?: {
              readonly assigneeId?: string;
              readonly hasDueDate?: boolean;
              readonly orderBy?: string;
            },
          ) => {
            if (options?.assigneeId) {
              return Promise.resolve([]);
            }

            if (options?.hasDueDate) {
              return Promise.resolve([deadlineNoDue]);
            }

            if (options?.orderBy === "updated_desc") {
              return Promise.resolve([myTaskToday]);
            }

            return Promise.resolve([myTaskNoDue, myTaskToday]);
          },
        ),
      },
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);

    const result = await loader({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: new Request("http://pages.invalid/dashboard"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(result.myTasks).toHaveLength(2);
    expect(result.myTasks[1]?.dueAt).toBe(today);
    expect(result.projectOverview).toHaveLength(2);
    expect(result.projectOverview[0]?.percentage).toBe(75);
    expect(result.upcomingDeadlines).toHaveLength(1);
    expect(result.upcomingDeadlines[0]?.dueAt).toBe("");
    expect(result.upcomingDeadlines[0]?.daysLeft).toBe(0);
  });
});
