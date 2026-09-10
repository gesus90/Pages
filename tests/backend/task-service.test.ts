import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import {
  generateProjectKey,
  TaskService,
  WorkItemAccessDeniedError,
  WorkItemHierarchyError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/service/TaskService";
import { ROLE } from "@/definition/Role";
import {
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  WorkItemDetail,
  WorkItemLinkType,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin User",
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

function createStatus(overrides: Partial<WorkflowStatus> = {}): WorkflowStatus {
  return {
    id: "status-todo",
    isDone: false,
    key: WORKFLOW_STATUS_KEY.TODO,
    name: "To Do",
    position: 1,
    projectId: null,
    ...overrides,
  };
}

function createMilestone(overrides: Partial<Milestone> = {}): Milestone {
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
    ...overrides,
  };
}

function createWorkItem(
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeId: "user-1",
    assigneeName: "Admin User",
    reporterName: "Reporter User",
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "Work item description",
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
    key: "PAGE-1",
    milestoneId: "milestone-1",
    milestoneName: "v1.0",
    number: 1,
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
    title: "Setup Task",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

describe("generateProjectKey", () => {
  it("derives correct prefix keys for known examples and various patterns", () => {
    expect(generateProjectKey("Pages")).toBe("PAGE");
    expect(generateProjectKey("AstroLab")).toBe("ASTRO");
    expect(generateProjectKey("Animus")).toBe("ANI");
    expect(generateProjectKey("   ")).toBe("TASK");
    expect(generateProjectKey("AlphaBeta")).toBe("ALPHA");
    expect(generateProjectKey("Core Engine Mobile")).toBe("CEM");
    expect(generateProjectKey("App")).toBe("APP");
    expect(generateProjectKey("Tool")).toBe("TOOL");
    expect(generateProjectKey("LongProjectName")).toBe("LONG");
    expect(generateProjectKey("system")).toBe("SYST");
    expect(generateProjectKey("A !")).toBe("A");
    expect(generateProjectKey("IoServer")).toBe("IOSE");
  });

  it("instantiates WorkItemAccessDeniedError with correct message", () => {
    const error = new WorkItemAccessDeniedError();
    expect(error.message).toContain(
      "This user is not allowed to access tasks for this project.",
    );
  });
});

describe("TaskService", () => {
  let repository: { [key: string]: ReturnType<typeof vi.fn> };
  let projectService: { [key: string]: ReturnType<typeof vi.fn> };
  let permissionService: { [key: string]: ReturnType<typeof vi.fn> };
  let service: TaskService;

  beforeEach(() => {
    repository = {
      archive: vi.fn().mockResolvedValue(undefined),
      assignLabel: vi.fn().mockResolvedValue(undefined),
      countLabelUsage: vi.fn().mockResolvedValue(0),
      countLabelUsageByProjectIds: vi.fn().mockResolvedValue(new Map()),
      countWorkItemsByProject: vi.fn().mockResolvedValue(new Map()),
      countWorkItemsOverview: vi.fn().mockResolvedValue({
        assigned: 0,
        inProgress: 0,
        open: 0,
        openDelta: 0,
        overdue: 0,
        overdueDelta: 0,
      }),
      deleteChecklistItem: vi.fn().mockResolvedValue(undefined),
      deleteLabel: vi.fn().mockResolvedValue(undefined),
      deleteLink: vi.fn().mockResolvedValue(undefined),
      findAll: vi.fn().mockResolvedValue([]),
      findAllStatuses: vi.fn().mockResolvedValue([]),
      findChecklistItemById: vi.fn().mockResolvedValue(null),
      findChecklistItemsByWorkItemId: vi.fn().mockResolvedValue([]),
      findEligibleAssignees: vi.fn().mockResolvedValue([]),
      findEligibleAssigneesByProjectIds: vi.fn().mockResolvedValue(new Map()),
      findById: vi.fn(),
      findByKey: vi.fn(),
      findHistoryByWorkItemId: vi.fn().mockResolvedValue([]),
      findLabelById: vi.fn().mockResolvedValue(null),
      findLabelsByProjectId: vi.fn().mockResolvedValue([]),
      findLabelsByProjectIds: vi.fn().mockResolvedValue(new Map()),
      findLabelsForWorkItemIds: vi.fn().mockResolvedValue(new Map()),
      findLinkById: vi.fn().mockResolvedValue(null),
      findLinksByWorkItemId: vi.fn().mockResolvedValue([]),
      findMilestoneById: vi.fn().mockResolvedValue(createMilestone()),
      findMilestonesByProjectIds: vi.fn().mockResolvedValue([]),
      findOrCreateProjectKey: vi.fn().mockResolvedValue("PAGE"),
      findStatusById: vi.fn().mockResolvedValue(createStatus()),
      findSubtasks: vi.fn().mockResolvedValue([]),
      getNextNumber: vi.fn().mockResolvedValue(1),
      insert: vi.fn().mockResolvedValue(undefined),
      insertChecklistItem: vi.fn().mockResolvedValue(undefined),
      insertHistory: vi.fn().mockResolvedValue(undefined),
      insertLabel: vi.fn().mockResolvedValue(undefined),
      insertLink: vi.fn().mockResolvedValue(undefined),
      moveToProject: vi.fn().mockResolvedValue(undefined),
      removeAllLabelsFromWorkItem: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
      setGitHubConflict: vi.fn().mockResolvedValue(undefined),
      setGitHubError: vi.fn().mockResolvedValue(undefined),
      unassignLabel: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      updateChecklistItem: vi.fn().mockResolvedValue(undefined),
      updateGitHubLink: vi.fn().mockResolvedValue(undefined),
      updateLabel: vi.fn().mockResolvedValue(undefined),
      updateStatusAndOrder: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof repository;

    projectService = {
      canWriteProject: vi.fn().mockResolvedValue(true),
      findAll: vi.fn(),
      getById: vi.fn(),
    } as unknown as typeof projectService;

    permissionService = {
      hasPermission: vi.fn(),
    } as unknown as typeof permissionService;

    service = new TaskService(
      repository as unknown as TaskRepository,
      projectService as unknown as ProjectService,
      permissionService as unknown as PermissionService,
    );
  });

  it("returns all statuses and milestones for accessible projects", async () => {
    const actor = createUser();
    repository.findAllStatuses.mockResolvedValue([createStatus()]);
    projectService.findAll.mockResolvedValue([createProject()]);
    repository.findMilestonesByProjectIds.mockResolvedValue([
      createMilestone(),
    ]);

    await expect(service.findAllStatuses()).resolves.toHaveLength(1);
    await expect(
      service.findMilestones(actor, ["project-1", "foreign-project"]),
    ).resolves.toHaveLength(1);
    expect(repository.findMilestonesByProjectIds).toHaveBeenCalledWith([
      "project-1",
    ]);
  });

  it("returns eligible assignees after verifying project access", async () => {
    const actor = createUser();
    projectService.getById.mockResolvedValue(createProject());
    repository.findEligibleAssignees.mockResolvedValue([actor]);

    await expect(
      service.findEligibleAssignees(actor, "project-1"),
    ).resolves.toEqual([actor]);
  });

  it("finds all accessible work items applying actor filters", async () => {
    const actor = createUser();
    projectService.findAll.mockResolvedValue([createProject()]);
    repository.findAll.mockResolvedValue([createWorkItem()]);

    const items = await service.findAll(actor);

    expect(items).toHaveLength(1);
    expect(repository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: ["project-1"] }),
    );

    const filtered = await service.findAll(actor, {
      projectIds: ["project-1", "foreign-1"],
    });

    expect(filtered).toHaveLength(1);
    expect(repository.findAll).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectIds: ["project-1"] }),
    );

    projectService.findAll.mockResolvedValueOnce([]);

    await expect(service.findAll(actor)).resolves.toEqual([]);
  });

  it("gets work items by id and key with project authorization", async () => {
    const actor = createUser();
    const item = createWorkItem();
    repository.findById.mockResolvedValueOnce(item).mockResolvedValueOnce(null);
    projectService.getById.mockResolvedValue(createProject());

    await expect(service.getById(actor, "item-1")).resolves.toEqual(item);
    await expect(service.getById(actor, "missing")).rejects.toThrow(
      WorkItemNotFoundError,
    );

    repository.findByKey
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce(null);

    await expect(service.getByKey(actor, "PAGE-1")).resolves.toEqual(item);
    await expect(service.getByKey(actor, "PAGE-99")).rejects.toThrow(
      WorkItemNotFoundError,
    );
  });

  it("finds subtasks and history for authorized work items", async () => {
    const actor = createUser();
    const item = createWorkItem();
    repository.findById.mockResolvedValue(item);
    projectService.getById.mockResolvedValue(createProject());
    repository.findSubtasks.mockResolvedValue([item]);
    repository.findHistoryByWorkItemId.mockResolvedValue([]);

    await expect(service.findSubtasks(actor, "item-1")).resolves.toHaveLength(
      1,
    );
    await expect(service.getHistory(actor, "item-1")).resolves.toEqual([]);
  });

  it("creates a work item successfully and records history", async () => {
    const actor = createUser();
    const project = createProject();
    projectService.getById.mockResolvedValue(project);
    repository.findStatusById.mockResolvedValue(createStatus());
    repository.findMilestoneById.mockResolvedValue(createMilestone());
    repository.findEligibleAssignees.mockResolvedValue([actor]);
    repository.findOrCreateProjectKey.mockResolvedValue("PAGE");
    repository.getNextNumber.mockResolvedValue(5);
    repository.findById.mockResolvedValue(createWorkItem({ key: "PAGE-5" }));

    const created = await service.create(actor, {
      assigneeId: actor.id,
      description: "Work details",
      dueAt: "2026-06-01",
      milestoneId: "milestone-1",
      parentId: null,
      priority: WORK_ITEM_PRIORITY.HIGH,
      projectId: "project-1",
      statusId: "status-todo",
      title: "New Task",
      type: WORK_ITEM_TYPE.TASK,
    });

    expect(created.key).toBe("PAGE-5");
    expect(repository.insert).toHaveBeenCalledTimes(1);
    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ action: "created" }),
    );
  });

  it("validates title, description, type, and status on creation", async () => {
    const actor = createUser();
    projectService.getById.mockResolvedValue(createProject());

    await expect(
      service.create(actor, {
        projectId: "project-1",
        statusId: "status-1",
        title: "",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow(WorkItemValidationError);

    await expect(
      service.create(actor, {
        description: "a".repeat(10_001),
        projectId: "project-1",
        statusId: "status-1",
        title: "Valid",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow(WorkItemValidationError);

    await expect(
      service.create(actor, {
        projectId: "project-1",
        statusId: "status-1",
        title: "Valid",
        type: "invalid" as unknown as typeof WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow(WorkItemValidationError);

    await expect(
      service.create(actor, {
        priority: "invalid" as unknown as typeof WORK_ITEM_PRIORITY.NORMAL,
        projectId: "project-1",
        statusId: "status-1",
        title: "Valid",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow(WorkItemValidationError);

    repository.findStatusById.mockResolvedValue(null);

    await expect(
      service.create(actor, {
        projectId: "project-1",
        statusId: "missing-status",
        title: "Valid",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow(WorkItemValidationError);
  });

  it("enforces hierarchy rules on creation", async () => {
    const actor = createUser();
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());

    await expect(
      service.create(actor, {
        parentId: "some-parent",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Epic with parent",
        type: WORK_ITEM_TYPE.EPIC,
      }),
    ).rejects.toThrow(WorkItemHierarchyError);

    await expect(
      service.create(actor, {
        parentId: null,
        projectId: "project-1",
        statusId: "status-todo",
        title: "Subtask without parent",
        type: WORK_ITEM_TYPE.SUBTASK,
      }),
    ).rejects.toThrow(WorkItemHierarchyError);

    repository.findById.mockResolvedValueOnce(null);

    await expect(
      service.create(actor, {
        parentId: "missing-parent",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Subtask",
        type: WORK_ITEM_TYPE.SUBTASK,
      }),
    ).rejects.toThrow(WorkItemHierarchyError);

    repository.findById.mockResolvedValueOnce(
      createWorkItem({ type: WORK_ITEM_TYPE.EPIC }),
    );

    await expect(
      service.create(actor, {
        parentId: "parent-epic",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Subtask on epic",
        type: WORK_ITEM_TYPE.SUBTASK,
      }),
    ).rejects.toThrow("A Subtask can only be attached to a Task.");

    repository.findById.mockResolvedValueOnce(
      createWorkItem({
        projectId: "foreign-project",
        type: WORK_ITEM_TYPE.TASK,
      }),
    );

    await expect(
      service.create(actor, {
        parentId: "foreign-task",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Subtask foreign",
        type: WORK_ITEM_TYPE.SUBTASK,
      }),
    ).rejects.toThrow("Parent task must belong to the same project.");

    repository.findById.mockResolvedValueOnce(null);

    await expect(
      service.create(actor, {
        parentId: "missing-epic",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Task with missing epic",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow("The specified Epic does not exist.");

    repository.findById.mockResolvedValueOnce(
      createWorkItem({ type: WORK_ITEM_TYPE.TASK }),
    );

    await expect(
      service.create(actor, {
        parentId: "other-task",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Task on task",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow("A Task can only have an Epic as its parent.");

    repository.findById.mockResolvedValueOnce(
      createWorkItem({
        projectId: "foreign-project",
        type: WORK_ITEM_TYPE.EPIC,
      }),
    );

    await expect(
      service.create(actor, {
        parentId: "foreign-epic",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Task on foreign epic",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow("Parent Epic must belong to the same project.");
  });

  it("validates milestones and assignees on creation", async () => {
    const actor = createUser();
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());

    repository.findMilestoneById.mockResolvedValueOnce(null);

    await expect(
      service.create(actor, {
        milestoneId: "missing-m",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Valid",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow(WorkItemValidationError);

    repository.findMilestoneById.mockResolvedValueOnce(
      createMilestone({ projectId: "foreign-proj" }),
    );

    await expect(
      service.create(actor, {
        milestoneId: "foreign-m",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Valid",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow("Milestone does not belong to the selected project.");

    repository.findMilestoneById.mockResolvedValue(createMilestone());
    repository.findEligibleAssignees.mockResolvedValue([]);

    await expect(
      service.create(actor, {
        assigneeId: "unauthorized-user",
        milestoneId: "milestone-1",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Valid",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow(
      "Selected assignee does not have access to this project.",
    );
  });

  it("updates existing work items and tracks modified field history", async () => {
    const actor = createUser();

    repository.findById.mockImplementation((id: string) => {
      if (id === "epic-1") {
        return Promise.resolve(
          createWorkItem({
            id: "epic-1",
            key: "PAGE-2",
            type: WORK_ITEM_TYPE.EPIC,
          }),
        );
      }
      return Promise.resolve(createWorkItem({ title: "Updated title" }));
    });
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(
      createStatus({ id: "status-done", isDone: true, name: "Done" }),
    );
    repository.findMilestoneById.mockResolvedValue(
      createMilestone({ id: "milestone-2", name: "v2.0" }),
    );
    repository.findEligibleAssignees.mockResolvedValue([
      actor,
      createUser({ displayName: "New User", id: "user-2" }),
    ]);

    const updated = await service.update(actor, "item-1", {
      assigneeId: "user-2",
      description: "New description",
      dueAt: "2026-05-01",
      milestoneId: "milestone-2",
      parentId: "epic-1",
      priority: WORK_ITEM_PRIORITY.URGENT,
      reporterId: "user-1",
      startAt: "2026-09-01",
      statusId: "status-done",
      title: "Updated title",
    });

    expect(updated.title).toBe("Updated title");
    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(repository.insertHistory).toHaveBeenCalled();
  });

  it("prevents circular self-parent references on update", async () => {
    const actor = createUser();
    const existing = createWorkItem({
      id: "item-1",
      type: WORK_ITEM_TYPE.TASK,
    });
    repository.findById.mockResolvedValue(existing);
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());

    await expect(
      service.update(actor, "item-1", {
        assigneeId: null,
        description: "",
        dueAt: null,
        milestoneId: null,
        parentId: "item-1",
        priority: WORK_ITEM_PRIORITY.NORMAL,
        reporterId: "user-1",
        startAt: null,
        statusId: "status-todo",
        title: "Self parent",
      }),
    ).rejects.toThrow("A Task cannot be its own parent.");

    const existingSubtask = createWorkItem({
      id: "sub-1",
      type: WORK_ITEM_TYPE.SUBTASK,
    });
    repository.findById.mockResolvedValue(existingSubtask);

    await expect(
      service.update(actor, "sub-1", {
        assigneeId: null,
        description: "",
        dueAt: null,
        milestoneId: null,
        parentId: "sub-1",
        priority: WORK_ITEM_PRIORITY.NORMAL,
        reporterId: "user-1",
        startAt: null,
        statusId: "status-todo",
        title: "Self parent subtask",
      }),
    ).rejects.toThrow("A Subtask cannot be its own parent.");
  });

  it("updates status and order during drag & drop and logs changes", async () => {
    const actor = createUser();
    const existing = createWorkItem({
      statusId: "status-todo",
      statusName: "To Do",
    });
    repository.findById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(createWorkItem({ statusId: "status-done" }));
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(
      createStatus({ id: "status-done", isDone: true, name: "Done" }),
    );

    await service.updateStatusAndOrder(actor, "item-1", "status-done", 2);

    expect(repository.updateStatusAndOrder).toHaveBeenCalledWith(
      "item-1",
      "status-done",
      2,
      true,
    );
    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ action: "status_changed" }),
    );

    repository.findById.mockResolvedValue(existing);
    repository.findStatusById.mockResolvedValueOnce(null);

    await expect(
      service.updateStatusAndOrder(actor, "item-1", "missing-status", 1),
    ).rejects.toThrow(WorkItemValidationError);
  });

  it("archives a work item and records history", async () => {
    const actor = createUser();
    repository.findById.mockResolvedValue(createWorkItem());
    projectService.getById.mockResolvedValue(createProject());

    await service.archive(actor, "item-1");

    expect(repository.archive).toHaveBeenCalledWith("item-1");
    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ action: "archived" }),
    );
  });

  it("successfully creates Epic without parent and Subtask with valid parent", async () => {
    const actor = createUser();
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());
    repository.findOrCreateProjectKey.mockResolvedValue("PAGE");
    repository.getNextNumber.mockResolvedValue(1);

    repository.findById
      .mockResolvedValueOnce(
        createWorkItem({ id: "epic-1", type: WORK_ITEM_TYPE.EPIC }),
      )
      .mockResolvedValueOnce(
        createWorkItem({ id: "task-1", type: WORK_ITEM_TYPE.TASK }),
      )
      .mockResolvedValueOnce(
        createWorkItem({ id: "sub-1", type: WORK_ITEM_TYPE.SUBTASK }),
      );

    const epic = await service.create(actor, {
      projectId: "project-1",
      statusId: "status-todo",
      title: "Epic Title",
      type: WORK_ITEM_TYPE.EPIC,
    });
    expect(epic.type).toBe(WORK_ITEM_TYPE.EPIC);

    const subtask = await service.create(actor, {
      parentId: "task-1",
      projectId: "project-1",
      statusId: "status-todo",
      title: "Subtask Title",
      type: WORK_ITEM_TYPE.SUBTASK,
    });
    expect(subtask.type).toBe(WORK_ITEM_TYPE.SUBTASK);
  });

  it("nests initiatives above epics in the planning hierarchy", async () => {
    const actor = createUser();
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());
    repository.findOrCreateProjectKey.mockResolvedValue("PAGE");
    repository.getNextNumber.mockResolvedValue(1);

    repository.findById.mockResolvedValue(
      createWorkItem({ id: "created", type: WORK_ITEM_TYPE.INITIATIVE }),
    );

    const initiative = await service.create(actor, {
      projectId: "project-1",
      statusId: "status-todo",
      title: "Platform Initiative",
      type: WORK_ITEM_TYPE.INITIATIVE,
    });
    expect(initiative.type).toBe(WORK_ITEM_TYPE.INITIATIVE);

    await expect(
      service.create(actor, {
        parentId: "some-parent",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Initiative with parent",
        type: WORK_ITEM_TYPE.INITIATIVE,
      }),
    ).rejects.toThrow("An Initiative cannot have a parent work item.");

    repository.findById
      .mockResolvedValueOnce(
        createWorkItem({ id: "init-1", type: WORK_ITEM_TYPE.INITIATIVE }),
      )
      .mockResolvedValue(
        createWorkItem({ id: "created", type: WORK_ITEM_TYPE.EPIC }),
      );

    const epic = await service.create(actor, {
      parentId: "init-1",
      projectId: "project-1",
      statusId: "status-todo",
      title: "Epic in initiative",
      type: WORK_ITEM_TYPE.EPIC,
    });
    expect(epic.type).toBe(WORK_ITEM_TYPE.EPIC);

    repository.findById.mockResolvedValue(
      createWorkItem({ id: "task-1", type: WORK_ITEM_TYPE.TASK }),
    );

    await expect(
      service.create(actor, {
        parentId: "task-1",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Epic on task",
        type: WORK_ITEM_TYPE.EPIC,
      }),
    ).rejects.toThrow("An Epic can only belong to an Initiative.");

    const ownEpic = createWorkItem({ id: "epic-1", type: WORK_ITEM_TYPE.EPIC });
    repository.findById.mockResolvedValue(ownEpic);

    await expect(
      service.update(actor, "epic-1", {
        assigneeId: null,
        description: "",
        dueAt: null,
        milestoneId: null,
        parentId: "epic-1",
        priority: WORK_ITEM_PRIORITY.NORMAL,
        reporterId: "user-1",
        startAt: null,
        statusId: "status-todo",
        title: "Epic on itself",
      }),
    ).rejects.toThrow("An Epic cannot be its own parent.");

    repository.findById.mockResolvedValue(
      createWorkItem({
        id: "foreign-init",
        projectId: "foreign-project",
        type: WORK_ITEM_TYPE.INITIATIVE,
      }),
    );

    await expect(
      service.create(actor, {
        parentId: "foreign-init",
        projectId: "project-1",
        statusId: "status-todo",
        title: "Epic on foreign initiative",
        type: WORK_ITEM_TYPE.EPIC,
      }),
    ).rejects.toThrow("Parent Initiative must belong to the same project.");
  });

  it("publishes task mutations to GitHub without failing them", async () => {
    const actor = createUser();
    const publishTaskUpdate = vi.fn().mockResolvedValue(undefined);
    service.setGitHubSync({ publishTaskUpdate } as never);
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());
    repository.findOrCreateProjectKey.mockResolvedValue("PAGE");
    repository.getNextNumber.mockResolvedValue(1);
    repository.findById.mockResolvedValue(createWorkItem());

    await service.create(actor, {
      projectId: "project-1",
      startAt: "2026-09-01",
      statusId: "status-todo",
      title: "Sync me",
      type: WORK_ITEM_TYPE.TASK,
    });
    expect(publishTaskUpdate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ id: "item-1" }),
    );
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ startAt: "2026-09-01" }),
    );

    publishTaskUpdate.mockClear();

    await service.create(actor, {
      projectId: "project-1",
      skipGitHubSync: true,
      statusId: "status-todo",
      title: "Skip me",
      type: WORK_ITEM_TYPE.TASK,
    });
    expect(publishTaskUpdate).not.toHaveBeenCalled();

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    publishTaskUpdate.mockRejectedValueOnce(new Error("GitHub down"));

    await service.create(actor, {
      projectId: "project-1",
      statusId: "status-todo",
      title: "Survives sync failure",
      type: WORK_ITEM_TYPE.TASK,
    });

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("PAGE-1"),
      expect.any(Error),
    );
    log.mockRestore();
  });

  it("publishes updates and status moves to GitHub", async () => {
    const actor = createUser();
    const publishTaskUpdate = vi.fn().mockResolvedValue(undefined);
    service.setGitHubSync({ publishTaskUpdate } as never);
    const existing = createWorkItem();
    repository.findById.mockResolvedValue(existing);
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());
    repository.findEligibleAssignees.mockResolvedValue([actor]);

    await service.update(actor, "item-1", {
      assigneeId: null,
      description: existing.description,
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: WORK_ITEM_PRIORITY.NORMAL,
      reporterId: "user-1",
      startAt: null,
      statusId: "status-todo",
      title: existing.title,
    });
    expect(publishTaskUpdate).toHaveBeenCalledTimes(1);

    repository.findStatusById.mockResolvedValue(
      createStatus({ id: "status-done", isDone: true }),
    );

    await service.updateStatusAndOrder(actor, "item-1", "status-done", 1);
    expect(publishTaskUpdate).toHaveBeenCalledTimes(2);
  });

  it("handles update with unchanged fields and null parents/milestones", async () => {
    const actor = createUser();
    const existing = createWorkItem({
      assigneeId: "user-1",
      description: "Same desc",
      dueAt: "2026-05-01",
      milestoneId: "milestone-1",
      parentId: "epic-1",
      priority: WORK_ITEM_PRIORITY.NORMAL,
      statusId: "status-todo",
      title: "Same title",
    });

    const epicParent = createWorkItem({
      id: "epic-1",
      type: WORK_ITEM_TYPE.EPIC,
    });

    repository.findById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(epicParent)
      .mockResolvedValueOnce(existing);
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(
      createStatus({ id: "status-todo" }),
    );
    repository.findMilestoneById.mockResolvedValue(createMilestone());
    repository.findEligibleAssignees.mockResolvedValue([actor]);

    await service.update(actor, "item-1", {
      assigneeId: "user-1",
      description: "Same desc",
      dueAt: "2026-05-01",
      milestoneId: "milestone-1",
      parentId: "epic-1",
      priority: WORK_ITEM_PRIORITY.NORMAL,
      reporterId: "user-1",
      startAt: null,
      statusId: "status-todo",
      title: "Same title",
    });

    expect(repository.update).toHaveBeenCalledTimes(1);

    repository.findById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(createWorkItem());
    repository.findEligibleAssignees.mockResolvedValue([actor]);

    await service.update(actor, "item-1", {
      assigneeId: null,
      description: "Same desc",
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: WORK_ITEM_PRIORITY.NORMAL,
      reporterId: "user-1",
      startAt: null,
      statusId: "status-todo",
      title: "Same title",
    });

    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ action: "parent_changed", newValue: null }),
    );
  });

  it("does not log status_changed when updating order to same status", async () => {
    const actor = createUser();
    const existing = createWorkItem({ statusId: "status-todo" });

    repository.findById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(
      createStatus({ id: "status-todo" }),
    );

    await service.updateStatusAndOrder(actor, "item-1", "status-todo", 5);

    expect(repository.insertHistory).not.toHaveBeenCalled();
  });

  it("throws when work item cannot be retrieved after creation or update", async () => {
    const actor = createUser();
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());
    repository.findOrCreateProjectKey.mockResolvedValue("PAGE");
    repository.getNextNumber.mockResolvedValue(1);
    repository.findEligibleAssignees.mockResolvedValue([actor]);
    repository.findById.mockResolvedValueOnce(null);

    await expect(
      service.create(actor, {
        projectId: "project-1",
        statusId: "status-todo",
        title: "T",
        type: WORK_ITEM_TYPE.TASK,
      }),
    ).rejects.toThrow("Created work item could not be retrieved.");

    const existing = createWorkItem();
    repository.findById.mockResolvedValueOnce(existing);
    repository.findStatusById.mockResolvedValueOnce(null);

    await expect(
      service.update(actor, "item-1", {
        assigneeId: null,
        description: "",
        dueAt: null,
        milestoneId: null,
        parentId: null,
        priority: WORK_ITEM_PRIORITY.NORMAL,
        reporterId: "user-1",
        startAt: null,
        statusId: "status-missing",
        title: "T",
      }),
    ).rejects.toThrow("Selected status does not exist.");

    repository.findById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);
    repository.findStatusById.mockResolvedValueOnce(createStatus());

    await expect(
      service.update(actor, "item-1", {
        assigneeId: null,
        description: "",
        dueAt: null,
        milestoneId: null,
        parentId: null,
        priority: WORK_ITEM_PRIORITY.NORMAL,
        reporterId: "user-1",
        startAt: null,
        statusId: "status-todo",
        title: "T",
      }),
    ).rejects.toThrow("Updated work item could not be retrieved.");

    repository.findById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);
    repository.findStatusById.mockResolvedValueOnce(createStatus());

    await expect(
      service.updateStatusAndOrder(actor, "item-1", "status-todo", 1),
    ).rejects.toThrow("Work item could not be retrieved after status update.");
  });

  it("handles history logging when new parent or milestone details cannot be fetched", async () => {
    const actor = createUser();
    const existing = createWorkItem({
      milestoneId: null,
      parentId: null,
    });

    repository.findById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(
        createWorkItem({ id: "epic-1", type: WORK_ITEM_TYPE.EPIC }),
      )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createWorkItem());
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());
    repository.findEligibleAssignees.mockResolvedValue([actor]);
    repository.findMilestoneById
      .mockResolvedValueOnce(createMilestone())
      .mockResolvedValueOnce(null);

    await service.update(actor, "item-1", {
      assigneeId: null,
      description: existing.description,
      dueAt: null,
      milestoneId: "milestone-1",
      parentId: "epic-1",
      priority: existing.priority,
      reporterId: "user-1",
      startAt: null,
      statusId: existing.statusId,
      title: existing.title,
    });

    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ action: "parent_changed", newValue: null }),
    );
    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ action: "milestone_changed", newValue: null }),
    );
  });

  it("validates title, description, and priority on update", async () => {
    const actor = createUser();
    const existing = createWorkItem();
    repository.findById.mockResolvedValue(existing);
    projectService.getById.mockResolvedValue(createProject());

    await expect(
      service.update(actor, "item-1", {
        assigneeId: null,
        description: "Valid",
        dueAt: null,
        milestoneId: null,
        parentId: null,
        priority: WORK_ITEM_PRIORITY.NORMAL,
        reporterId: "user-1",
        startAt: null,
        statusId: "status-todo",
        title: "",
      }),
    ).rejects.toThrow(WorkItemValidationError);

    await expect(
      service.update(actor, "item-1", {
        assigneeId: null,
        description: "a".repeat(10_001),
        dueAt: null,
        milestoneId: null,
        parentId: null,
        priority: WORK_ITEM_PRIORITY.NORMAL,
        reporterId: "user-1",
        startAt: null,
        statusId: "status-todo",
        title: "Valid",
      }),
    ).rejects.toThrow(WorkItemValidationError);

    await expect(
      service.update(actor, "item-1", {
        assigneeId: null,
        description: "Valid",
        dueAt: null,
        milestoneId: null,
        parentId: null,
        priority: "invalid-prio" as unknown as typeof WORK_ITEM_PRIORITY.NORMAL,
        reporterId: "user-1",
        startAt: null,
        statusId: "status-todo",
        title: "Valid",
      }),
    ).rejects.toThrow(WorkItemValidationError);
  });
});

describe("TaskService restore, moves, labels, and sync state", () => {
  let repository: { [key: string]: ReturnType<typeof vi.fn> };
  let projectService: { [key: string]: ReturnType<typeof vi.fn> };
  let permissionService: { [key: string]: ReturnType<typeof vi.fn> };
  let service: TaskService;

  function createProjectLabel(overrides: Record<string, unknown> = {}): {
    color: string;
    createdAt: string;
    id: string;
    name: string;
    projectId: string;
    updatedAt: string;
  } {
    return {
      color: "#3b82f6",
      createdAt: "2026-01-01",
      id: "label-1",
      name: "Feature",
      projectId: "project-1",
      updatedAt: "2026-01-02",
      ...overrides,
    };
  }

  beforeEach(() => {
    repository = {
      archive: vi.fn().mockResolvedValue(undefined),
      assignLabel: vi.fn().mockResolvedValue(undefined),
      countLabelUsage: vi.fn().mockResolvedValue(0),
      countLabelUsageByProjectIds: vi.fn().mockResolvedValue(new Map()),
      countWorkItemsByProject: vi.fn().mockResolvedValue(new Map()),
      countWorkItemsOverview: vi.fn().mockResolvedValue({
        assigned: 0,
        inProgress: 0,
        open: 0,
        openDelta: 0,
        overdue: 0,
        overdueDelta: 0,
      }),
      deleteChecklistItem: vi.fn().mockResolvedValue(undefined),
      deleteLabel: vi.fn().mockResolvedValue(undefined),
      deleteLink: vi.fn().mockResolvedValue(undefined),
      findAll: vi.fn().mockResolvedValue([]),
      findAllStatuses: vi.fn().mockResolvedValue([]),
      findChecklistItemById: vi.fn().mockResolvedValue(null),
      findChecklistItemsByWorkItemId: vi.fn().mockResolvedValue([]),
      findEligibleAssignees: vi.fn().mockResolvedValue([]),
      findEligibleAssigneesByProjectIds: vi.fn().mockResolvedValue(new Map()),
      findById: vi.fn(),
      findByKey: vi.fn(),
      findHistoryByWorkItemId: vi.fn().mockResolvedValue([]),
      findLabelById: vi.fn().mockResolvedValue(null),
      findLabelsByProjectId: vi.fn().mockResolvedValue([]),
      findLabelsByProjectIds: vi.fn().mockResolvedValue(new Map()),
      findLabelsForWorkItemIds: vi.fn().mockResolvedValue(new Map()),
      findLinkById: vi.fn().mockResolvedValue(null),
      findLinksByWorkItemId: vi.fn().mockResolvedValue([]),
      findMilestoneById: vi.fn().mockResolvedValue(createMilestone()),
      findMilestonesByProjectIds: vi.fn().mockResolvedValue([]),
      findOrCreateProjectKey: vi.fn().mockResolvedValue("PAGE"),
      findStatusById: vi.fn().mockResolvedValue(createStatus()),
      findSubtasks: vi.fn().mockResolvedValue([]),
      getNextNumber: vi.fn().mockResolvedValue(1),
      insert: vi.fn().mockResolvedValue(undefined),
      insertChecklistItem: vi.fn().mockResolvedValue(undefined),
      insertHistory: vi.fn().mockResolvedValue(undefined),
      insertLabel: vi.fn().mockResolvedValue(undefined),
      insertLink: vi.fn().mockResolvedValue(undefined),
      moveToProject: vi.fn().mockResolvedValue(undefined),
      removeAllLabelsFromWorkItem: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
      setGitHubError: vi.fn().mockResolvedValue(undefined),
      unassignLabel: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      updateChecklistItem: vi.fn().mockResolvedValue(undefined),
      updateLabel: vi.fn().mockResolvedValue(undefined),
      updateStatusAndOrder: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof repository;

    projectService = {
      canWriteProject: vi.fn().mockResolvedValue(true),
      findAll: vi.fn(),
      getById: vi.fn(),
    } as unknown as typeof projectService;

    permissionService = {
      hasPermission: vi.fn(),
    } as unknown as typeof permissionService;

    service = new TaskService(
      repository as unknown as TaskRepository,
      projectService as unknown as ProjectService,
      permissionService as unknown as PermissionService,
    );
  });

  it("restores archived tickets with write permission", async () => {
    const actor = createUser();
    repository.findById.mockResolvedValue(createWorkItem());
    projectService.getById.mockResolvedValue(createProject());

    await service.restore(actor, "item-1");

    expect(repository.restore).toHaveBeenCalledWith("item-1");
    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ action: "restored" }),
    );

    projectService.canWriteProject.mockResolvedValueOnce(false);

    await expect(service.restore(actor, "item-1")).rejects.toThrow(
      WorkItemAccessDeniedError,
    );
  });

  it("moves tickets with their subtree and drops invalid relations", async () => {
    const actor = createUser();
    const item = createWorkItem({
      assigneeId: "user-1",
      githubIssueNumber: 82,
      milestoneId: "milestone-1",
      parentId: "epic-1",
    });
    repository.findById.mockResolvedValue(item);
    projectService.getById.mockResolvedValue(
      createProject({ id: "project-2", name: "AstroLab" }),
    );
    repository.findOrCreateProjectKey.mockResolvedValue("ASTRO");
    repository.getNextNumber.mockResolvedValue(5);
    repository.findEligibleAssignees.mockResolvedValue([]);

    const moved = await service.moveToProject(actor, "item-1", "project-2");

    expect(moved.id).toBe("item-1");
    expect(repository.moveToProject).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({
        assigneeId: null,
        key: "ASTRO-5",
        milestoneId: null,
        number: 5,
        parentId: null,
        projectId: "project-2",
      }),
    );
    expect(repository.removeAllLabelsFromWorkItem).toHaveBeenCalledWith(
      "item-1",
    );
    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project_changed",
        newValue: "AstroLab",
        oldValue: "Pages",
      }),
    );
    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "github_unlinked",
        oldValue: "#82",
      }),
    );
  });

  it("keeps relations that stay valid in the target project", async () => {
    const actor = createUser();
    const root = createWorkItem({
      assigneeId: null,
      assigneeName: null,
      id: "epic-1",
      milestoneId: null,
      milestoneName: null,
      type: WORK_ITEM_TYPE.EPIC,
    });
    const child = createWorkItem({
      id: "item-1",
      parentId: "epic-1",
      type: WORK_ITEM_TYPE.TASK,
    });
    repository.findById.mockResolvedValue(root);
    projectService.getById.mockResolvedValue(
      createProject({ id: "project-2", name: "AstroLab" }),
    );
    repository.findOrCreateProjectKey.mockResolvedValue("ASTRO");
    repository.getNextNumber.mockResolvedValue(2);
    repository.findSubtasks.mockResolvedValueOnce([child]);
    repository.findMilestoneById.mockResolvedValue(
      createMilestone({ projectId: "project-2" }),
    );
    repository.findEligibleAssignees.mockResolvedValue([actor]);

    await service.moveToProject(actor, "epic-1", "project-2");

    expect(repository.moveToProject).toHaveBeenCalledTimes(2);
    expect(repository.moveToProject).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({
        assigneeId: "user-1",
        milestoneId: "milestone-1",
        parentId: "epic-1",
        projectId: "project-2",
      }),
    );
    expect(repository.insertHistory).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "github_unlinked" }),
    );
  });

  it("rejects moves without permission, within one project, or without rows", async () => {
    const actor = createUser();
    repository.findById.mockResolvedValue(createWorkItem());
    projectService.getById.mockResolvedValue(createProject());

    projectService.canWriteProject.mockResolvedValueOnce(false);

    await expect(
      service.moveToProject(actor, "item-1", "project-2"),
    ).rejects.toThrow(WorkItemAccessDeniedError);

    projectService.canWriteProject
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      service.moveToProject(actor, "item-1", "project-2"),
    ).rejects.toThrow(WorkItemAccessDeniedError);

    await expect(
      service.moveToProject(actor, "item-1", "project-1"),
    ).rejects.toThrow("The ticket already belongs to the selected project.");

    repository.findById
      .mockResolvedValueOnce(createWorkItem())
      .mockResolvedValueOnce(createWorkItem())
      .mockResolvedValue(null);
    repository.findSubtasks.mockResolvedValue([]);

    await expect(
      service.moveToProject(actor, "item-1", "project-2"),
    ).rejects.toThrow("Moved work item could not be retrieved.");
  });

  it("rejects subtree collection for missing tickets", async () => {
    const actor = createUser();
    repository.findById
      .mockResolvedValueOnce(createWorkItem())
      .mockResolvedValue(null);
    projectService.getById.mockResolvedValue(
      createProject({ id: "project-2", name: "AstroLab" }),
    );

    await expect(
      service.moveToProject(actor, "item-1", "project-2"),
    ).rejects.toThrow(WorkItemNotFoundError);
  });

  it("records reporter changes and validates the reporter", async () => {
    const actor = createUser();
    repository.findById.mockResolvedValue(createWorkItem());
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());
    repository.findEligibleAssignees
      .mockResolvedValueOnce([
        actor,
        createUser({ displayName: "New User", id: "user-2" }),
      ])
      .mockResolvedValue([actor]);

    await service.update(actor, "item-1", {
      assigneeId: null,
      description: "Desc",
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: WORK_ITEM_PRIORITY.NORMAL,
      reporterId: "user-2",
      startAt: null,
      statusId: "status-todo",
      title: "Title",
    });

    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reporter_changed",
        newValue: null,
        oldValue: "Reporter User",
      }),
    );

    await expect(
      service.update(actor, "item-1", {
        assigneeId: null,
        description: "Desc",
        dueAt: null,
        milestoneId: null,
        parentId: null,
        priority: WORK_ITEM_PRIORITY.NORMAL,
        reporterId: "  ",
        startAt: null,
        statusId: "status-todo",
        title: "Title",
      }),
    ).rejects.toThrow("A reporter must be selected.");
  });

  it("creates, renames, and deletes project labels", async () => {
    const actor = createUser();
    projectService.getById.mockResolvedValue(createProject());

    repository.findLabelById.mockResolvedValue(createProjectLabel());
    const created = await service.createLabel(actor, "project-1", {
      color: "#ef4444",
      name: "Bug",
    });
    expect(created.id).toBe("label-1");
    expect(repository.insertLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Bug" }),
    );

    repository.findLabelById.mockResolvedValue(null);
    await expect(
      service.createLabel(actor, "project-1", {
        color: "#ef4444",
        name: "Bug",
      }),
    ).rejects.toThrow("Created label could not be retrieved.");

    await expect(
      service.createLabel(actor, "project-1", { color: "red", name: "Bug" }),
    ).rejects.toThrow("Unsupported label color.");

    await expect(
      service.createLabel(actor, "project-1", {
        color: "#ef4444",
        name: "   ",
      }),
    ).rejects.toThrow("Label name must be between 1 and 40 characters.");

    repository.findLabelsByProjectId.mockResolvedValue([createProjectLabel()]);
    await expect(
      service.createLabel(actor, "project-1", {
        color: "#ef4444",
        name: "feature",
      }),
    ).rejects.toThrow("A label with this name already exists");

    projectService.canWriteProject.mockResolvedValueOnce(false);
    await expect(
      service.createLabel(actor, "project-1", {
        color: "#ef4444",
        name: "Bug",
      }),
    ).rejects.toThrow(WorkItemAccessDeniedError);
  });

  it("updates project labels with uniqueness checks", async () => {
    const actor = createUser();
    const label = createProjectLabel();
    projectService.getById.mockResolvedValue(createProject());
    repository.findLabelsByProjectId.mockResolvedValue([label]);
    repository.findLabelById
      .mockResolvedValueOnce(label)
      .mockResolvedValueOnce({ ...label, name: "Feature Request" });

    const updated = await service.updateLabel(actor, "label-1", {
      color: "#a855f7",
      name: "Feature Request",
    });
    expect(updated.name).toBe("Feature Request");

    repository.findLabelById.mockResolvedValue(null);
    await expect(
      service.updateLabel(actor, "missing", {
        color: "#a855f7",
        name: "Other",
      }),
    ).rejects.toThrow("Selected label does not exist.");

    repository.findLabelById.mockResolvedValue(label);
    repository.findLabelsByProjectId.mockResolvedValue([
      label,
      createProjectLabel({ id: "label-2", name: "Bug" }),
    ]);
    await expect(
      service.updateLabel(actor, "label-1", {
        color: "#a855f7",
        name: "bug",
      }),
    ).rejects.toThrow("A label with this name already exists");

    await expect(
      service.updateLabel(actor, "label-1", { color: "red", name: "Bug" }),
    ).rejects.toThrow("Unsupported label color.");

    await expect(
      service.updateLabel(actor, "label-1", { color: "#a855f7", name: " " }),
    ).rejects.toThrow("Label name must be between 1 and 40 characters.");

    projectService.canWriteProject.mockResolvedValueOnce(false);
    await expect(
      service.updateLabel(actor, "label-1", {
        color: "#a855f7",
        name: "Bug",
      }),
    ).rejects.toThrow(WorkItemAccessDeniedError);

    repository.findLabelById
      .mockResolvedValueOnce(label)
      .mockResolvedValue(null);
    await expect(
      service.updateLabel(actor, "label-1", {
        color: "#a855f7",
        name: "Feature Request",
      }),
    ).rejects.toThrow("Updated label could not be retrieved.");
  });

  it("deletes labels and assigns them to tickets", async () => {
    const actor = createUser();
    const label = createProjectLabel();
    repository.findById.mockResolvedValue(createWorkItem());
    projectService.getById.mockResolvedValue(createProject());
    repository.findLabelById.mockResolvedValue(label);

    await service.assignLabel(actor, "item-1", "label-1");
    expect(repository.assignLabel).toHaveBeenCalledWith("item-1", "label-1");
    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "label_added",
        newValue: "Feature",
      }),
    );

    repository.findLabelById.mockResolvedValue({
      ...label,
      projectId: "foreign-project",
    });
    await expect(
      service.assignLabel(actor, "item-1", "label-1"),
    ).rejects.toThrow("Selected label does not belong");

    repository.findLabelById.mockResolvedValue(null);
    await expect(
      service.assignLabel(actor, "item-1", "label-1"),
    ).rejects.toThrow("Selected label does not belong");

    repository.findLabelById.mockResolvedValue(label);
    projectService.canWriteProject.mockResolvedValueOnce(false);
    await expect(
      service.assignLabel(actor, "item-1", "label-1"),
    ).rejects.toThrow(WorkItemAccessDeniedError);

    await service.unassignLabel(actor, "item-1", "label-1");
    expect(repository.unassignLabel).toHaveBeenCalledWith("item-1", "label-1");
    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "label_removed",
        oldValue: "Feature",
      }),
    );

    repository.findLabelById.mockResolvedValue(null);
    await service.unassignLabel(actor, "item-1", "label-1");
    expect(repository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ action: "label_removed", oldValue: null }),
    );

    projectService.canWriteProject.mockResolvedValueOnce(false);
    await expect(
      service.unassignLabel(actor, "item-1", "label-1"),
    ).rejects.toThrow(WorkItemAccessDeniedError);

    repository.findLabelById.mockResolvedValue(label);
    await service.deleteLabel(actor, "label-1");
    expect(repository.deleteLabel).toHaveBeenCalledWith("label-1");

    repository.findLabelById.mockResolvedValue(null);
    await expect(service.deleteLabel(actor, "missing")).rejects.toThrow(
      "Selected label does not exist.",
    );

    repository.findLabelById.mockResolvedValue(label);
    projectService.canWriteProject.mockResolvedValueOnce(false);
    await expect(service.deleteLabel(actor, "label-1")).rejects.toThrow(
      WorkItemAccessDeniedError,
    );
  });

  it("reads label catalogs and usage", async () => {
    const actor = createUser();
    projectService.getById.mockResolvedValue(createProject());
    repository.findLabelsByProjectId.mockResolvedValue([
      createProjectLabel(),
      createProjectLabel({ id: "label-2", name: "Bug" }),
    ]);
    repository.countLabelUsageByProjectIds.mockResolvedValue(
      new Map([
        [
          "project-1",
          new Map([
            ["label-1", 3],
            ["label-2", 5],
          ]),
        ],
      ]),
    );

    expect(await service.findLabels(actor, "project-1")).toHaveLength(2);

    const usage = await service.countLabelUsage(actor, "project-1");
    expect(usage.get("label-1")).toBe(3);
    expect(usage.get("label-2")).toBe(5);

    const mapped = new Map([["item-1", [createProjectLabel()]]]);
    repository.findLabelsForWorkItemIds.mockResolvedValue(mapped);
    expect(await service.findLabelsForWorkItems(["item-1"])).toBe(mapped);
  });

  it("persists GitHub synchronization failures without failing tickets", async () => {
    const actor = createUser();
    const publishTaskUpdate = vi.fn().mockResolvedValue(undefined);
    service.setGitHubSync({ publishTaskUpdate } as never);
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());
    repository.findOrCreateProjectKey.mockResolvedValue("PAGE");
    repository.getNextNumber.mockResolvedValue(1);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    async function flushBackgroundSync(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    try {
      repository.findById.mockResolvedValue(createWorkItem());
      publishTaskUpdate.mockRejectedValueOnce(new Error("GitHub down"));

      await service.create(actor, {
        projectId: "project-1",
        statusId: "status-todo",
        title: "Failing sync",
        type: WORK_ITEM_TYPE.TASK,
      });
      await flushBackgroundSync();

      expect(repository.setGitHubError).toHaveBeenCalledWith(
        "item-1",
        "GitHub down",
      );
      expect(repository.insertHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "github_sync_failed",
          newValue: "GitHub down",
        }),
      );

      repository.setGitHubError.mockClear();
      repository.insertHistory.mockClear();
      repository.findById.mockResolvedValue(
        createWorkItem({ githubLastError: "GitHub down" }),
      );
      publishTaskUpdate.mockRejectedValueOnce(new Error("GitHub down"));

      await service.create(actor, {
        projectId: "project-1",
        statusId: "status-todo",
        title: "Same failure",
        type: WORK_ITEM_TYPE.TASK,
      });
      await flushBackgroundSync();

      expect(repository.setGitHubError).not.toHaveBeenCalled();
      expect(repository.insertHistory).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "github_sync_failed" }),
      );

      repository.findById.mockResolvedValue(
        createWorkItem({ githubLastError: "GitHub down" }),
      );
      publishTaskUpdate.mockRejectedValueOnce("socket hang up");

      await service.create(actor, {
        projectId: "project-1",
        statusId: "status-todo",
        title: "Unknown failure",
        type: WORK_ITEM_TYPE.TASK,
      });
      await flushBackgroundSync();

      expect(repository.setGitHubError).toHaveBeenCalledWith(
        "item-1",
        "GitHub synchronization failed.",
      );
    } finally {
      log.mockRestore();
    }
  });

  it("clears stored sync errors after successful pushes", async () => {
    const actor = createUser();
    const publishTaskUpdate = vi.fn().mockResolvedValue(undefined);
    service.setGitHubSync({ publishTaskUpdate } as never);
    projectService.getById.mockResolvedValue(createProject());
    repository.findStatusById.mockResolvedValue(createStatus());
    repository.findOrCreateProjectKey.mockResolvedValue("PAGE");
    repository.getNextNumber.mockResolvedValue(1);
    repository.findById.mockResolvedValue(
      createWorkItem({ githubLastError: "Old error" }),
    );

    await service.create(actor, {
      projectId: "project-1",
      statusId: "status-todo",
      title: "Recovered sync",
      type: WORK_ITEM_TYPE.TASK,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(repository.setGitHubError).toHaveBeenCalledWith("item-1", null);
  });

  it("passes the archived filter to the repository", async () => {
    const actor = createUser();
    projectService.findAll.mockResolvedValue([createProject()]);
    repository.findAll.mockResolvedValue([]);

    await service.findAll(actor, { archived: "archived" });

    expect(repository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        archived: "archived",
        projectIds: ["project-1"],
      }),
    );
  });

  it("caches statuses, assignees, labels, and usage reads", async () => {
    const cachedService = new TaskService(
      repository as unknown as TaskRepository,
      projectService as unknown as ProjectService,
      permissionService as unknown as PermissionService,
      new ServerCache(),
    );
    repository.findAllStatuses.mockResolvedValue([createStatus()]);
    repository.findEligibleAssigneesByProjectIds.mockResolvedValue(
      new Map([["project-1", [createUser()]]]),
    );
    repository.findLabelsByProjectIds.mockResolvedValue(
      new Map([["project-1", []]]),
    );
    repository.countLabelUsageByProjectIds.mockResolvedValue(new Map());
    repository.findLabelsForWorkItemIds.mockResolvedValue(
      new Map([["item-1", []]]),
    );

    await cachedService.findAllStatuses();
    await cachedService.findAllStatuses();
    expect(repository.findAllStatuses).toHaveBeenCalledTimes(1);

    await cachedService.findAssigneesByProjects(["project-1"]);
    await cachedService.findAssigneesByProjects(["project-1"]);
    expect(repository.findEligibleAssigneesByProjectIds).toHaveBeenCalledTimes(
      1,
    );

    await cachedService.findLabelsByProjects(["project-1"]);
    await cachedService.findLabelsByProjects(["project-1"]);
    expect(repository.findLabelsByProjectIds).toHaveBeenCalledTimes(1);

    await cachedService.countLabelUsageByProjects(["project-1"]);
    await cachedService.countLabelUsageByProjects(["project-1"]);
    expect(repository.countLabelUsageByProjectIds).toHaveBeenCalledTimes(1);

    await cachedService.findLabelsForWorkItems(["item-1"]);
    await cachedService.findLabelsForWorkItems(["item-1"]);
    expect(repository.findLabelsForWorkItemIds).toHaveBeenCalledTimes(1);
  });

  it("delegates dashboard counters to the repository", async () => {
    const scope = {
      todayDate: "2026-09-07",
      userId: "user-1",
      weekAgoStart: "2026-08-31 00:00:00",
      yesterdayDate: "2026-09-06",
    };

    await service.countWorkItemsOverview(["project-1"], scope);
    expect(repository.countWorkItemsOverview).toHaveBeenCalledWith(
      ["project-1"],
      scope,
    );

    await service.countWorkItemsByProject(["project-1"]);
    expect(repository.countWorkItemsByProject).toHaveBeenCalledWith([
      "project-1",
    ]);
  });

  it("falls back to an empty usage map for unknown projects", async () => {
    projectService.getById.mockResolvedValue(createProject());
    repository.countLabelUsageByProjectIds.mockResolvedValue(new Map());

    await expect(
      service.countLabelUsage(createUser(), "project-1"),
    ).resolves.toEqual(new Map());
  });

  it("manages checklist items with access checks", async () => {
    const actor = createUser();
    const checklistItem = {
      createdAt: "2026-01-01",
      id: "check-1",
      isDone: false,
      sortOrder: 1,
      title: "Verify build",
      updatedAt: "2026-01-02",
      workItemId: "item-1",
    };
    repository.findById.mockResolvedValue(createWorkItem());
    repository.findChecklistItemById.mockResolvedValue(checklistItem);
    repository.findChecklistItemsByWorkItemId.mockResolvedValue([
      checklistItem,
    ]);

    await expect(
      service.findChecklistItems(actor, "item-1"),
    ).resolves.toHaveLength(1);

    await expect(
      service.addChecklistItem(actor, "item-1", "  Verify build  "),
    ).resolves.toMatchObject({ title: "Verify build" });
    expect(repository.insertChecklistItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Verify build", workItemId: "item-1" }),
    );

    await expect(
      service.setChecklistItemDone(actor, "check-1", true),
    ).resolves.toMatchObject({ isDone: false });
    expect(repository.updateChecklistItem).toHaveBeenCalledWith(
      "check-1",
      expect.objectContaining({ isDone: true }),
    );

    await service.deleteChecklistItem(actor, "check-1");
    expect(repository.deleteChecklistItem).toHaveBeenCalledWith("check-1");
  });

  it("rejects checklist operations without access or valid input", async () => {
    const actor = createUser();
    repository.findById.mockResolvedValue(createWorkItem());

    projectService.canWriteProject.mockResolvedValue(false);
    await expect(
      service.addChecklistItem(actor, "item-1", "Verify build"),
    ).rejects.toThrow(WorkItemAccessDeniedError);

    projectService.canWriteProject.mockResolvedValue(true);
    await expect(
      service.addChecklistItem(actor, "item-1", "   "),
    ).rejects.toThrow(WorkItemValidationError);

    repository.findChecklistItemById.mockResolvedValue(null);
    await expect(
      service.addChecklistItem(actor, "item-1", "Verify build"),
    ).rejects.toThrow("could not be retrieved");

    await expect(
      service.setChecklistItemDone(actor, "check-1", true),
    ).rejects.toThrow("does not exist");

    await expect(service.deleteChecklistItem(actor, "check-1")).rejects.toThrow(
      "does not exist",
    );

    repository.findChecklistItemById.mockResolvedValue({
      id: "check-1",
      workItemId: "item-1",
    });
    projectService.canWriteProject.mockResolvedValue(false);
    await expect(
      service.setChecklistItemDone(actor, "check-1", true),
    ).rejects.toThrow(WorkItemAccessDeniedError);
    await expect(service.deleteChecklistItem(actor, "check-1")).rejects.toThrow(
      WorkItemAccessDeniedError,
    );

    projectService.canWriteProject.mockResolvedValue(true);
    repository.findChecklistItemById
      .mockResolvedValueOnce({
        id: "check-1",
        title: "Verify build",
        workItemId: "item-1",
      })
      .mockResolvedValueOnce(null);
    await expect(
      service.setChecklistItemDone(actor, "check-1", false),
    ).rejects.toThrow("could not be retrieved");
  });

  it("manages work item links", async () => {
    const actor = createUser();
    repository.findById.mockResolvedValue(createWorkItem());
    repository.findByKey.mockResolvedValue(createWorkItem({ id: "item-2" }));
    repository.findLinksByWorkItemId.mockResolvedValue([
      {
        createdAt: "2026-01-01",
        direction: "outgoing",
        id: "link-1",
        linkType: "relates_to",
        linkedWorkItemId: "item-2",
        linkedWorkItemIsDone: false,
        linkedWorkItemKey: "PAGE-2",
        linkedWorkItemStatusKey: "todo",
        linkedWorkItemTitle: "Second task",
      },
    ]);

    await expect(service.findLinks(actor, "item-1")).resolves.toHaveLength(1);

    await expect(
      service.addLink(actor, "item-1", "PAGE-2", "relates_to"),
    ).resolves.toHaveLength(1);
    expect(repository.insertLink).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedWorkItemId: "item-2",
        workItemId: "item-1",
      }),
    );

    repository.findLinkById.mockResolvedValue({
      id: "link-1",
      linkType: "relates_to",
      linkedWorkItemId: "item-2",
      workItemId: "item-1",
    });
    await service.removeLink(actor, "item-1", "link-1");
    expect(repository.deleteLink).toHaveBeenCalledWith("link-1");
  });

  it("rejects link operations without access or invalid input", async () => {
    const actor = createUser();
    repository.findById.mockResolvedValue(createWorkItem());

    projectService.canWriteProject.mockResolvedValue(false);
    await expect(
      service.addLink(actor, "item-1", "PAGE-2", "relates_to"),
    ).rejects.toThrow(WorkItemAccessDeniedError);
    await expect(service.removeLink(actor, "item-1", "link-1")).rejects.toThrow(
      WorkItemAccessDeniedError,
    );

    projectService.canWriteProject.mockResolvedValue(true);
    await expect(
      service.addLink(actor, "item-1", "PAGE-2", "bogus" as WorkItemLinkType),
    ).rejects.toThrow("Unsupported link type");

    repository.findByKey.mockResolvedValue(null);
    await expect(
      service.addLink(actor, "item-1", "PAGE-9", "relates_to"),
    ).rejects.toThrow("does not exist");

    await expect(
      service.addLink(actor, "item-1", "   ", "relates_to"),
    ).rejects.toThrow("does not exist");

    repository.findByKey.mockResolvedValue(createWorkItem());
    await expect(
      service.addLink(actor, "item-1", "PAGE-1", "relates_to"),
    ).rejects.toThrow("cannot be linked to itself");

    repository.findLinkById.mockResolvedValue(null);
    await service.removeLink(actor, "item-1", "link-1");
    expect(repository.deleteLink).toHaveBeenCalledWith("link-1");

    repository.findLinkById.mockResolvedValue({
      id: "link-1",
      linkType: "relates_to",
      linkedWorkItemId: "item-9",
      workItemId: "item-8",
    });
    await expect(service.removeLink(actor, "item-1", "link-1")).rejects.toThrow(
      "does not belong to this ticket",
    );
  });
});
