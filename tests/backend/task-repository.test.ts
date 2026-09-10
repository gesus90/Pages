import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { ROLE } from "@/definition/Role";
import {
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";

import type { Database } from "@/backend/database/Database";

function createDatabase(): Database & {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    execute: vi.fn(),
    migrate: vi.fn(),
    query: vi.fn(),
  } as unknown as Database & {
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
}

function createStatusRow(
  overrides: readonly unknown[] = [],
): readonly unknown[] {
  const row: unknown[] = [
    "status-1",
    null,
    WORKFLOW_STATUS_KEY.TODO,
    "To Do",
    1,
    0,
  ];

  overrides.forEach((value, index) => {
    row[index] = value;
  });

  return row;
}

function createMilestoneRow(
  overrides: readonly unknown[] = [],
): readonly unknown[] {
  const row: unknown[] = [
    "milestone-1",
    "project-1",
    "Release v1.0",
    "First deliverable",
    "open",
    "2026-01-01",
    "2026-02-01",
    "2026-01-01",
    "2026-01-02",
    null,
    null,
  ];

  overrides.forEach((value, index) => {
    row[index] = value;
  });

  return row;
}

function createWorkItemRow(
  overrides: readonly unknown[] = [],
): readonly unknown[] {
  return [
    "item-1",
    "project-1",
    "PAGE-1",
    1,
    WORK_ITEM_TYPE.TASK,
    null,
    "Setup board",
    "Build the kanban board",
    "status-1",
    WORK_ITEM_PRIORITY.HIGH,
    "user-1",
    "user-1",
    "milestone-1",
    "2026-03-01",
    1,
    "2026-01-01",
    "2026-01-02",
    null,
    null,
    "Pages",
    "todo",
    "To Do",
    0,
    "Admin Müller",
    "Release v1.0",
    null,
    null,
    2,
    1,
    null,
    null,
    null,
    null,
    null,
    0,
    null,
    "Reporter Müller",
    "2026-02-01",
    "Forbidden",
    ...overrides,
  ];
}

function createHistoryRow(
  overrides: readonly unknown[] = [],
): readonly unknown[] {
  return [
    "hist-1",
    "item-1",
    "user-1",
    "Admin",
    "status_changed",
    "status",
    "To Do",
    "In Arbeit",
    "2026-01-02 12:00:00",
    ...overrides,
  ];
}

describe("TaskRepository", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: TaskRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new TaskRepository(database);
  });

  it("returns all workflow statuses", async () => {
    database.query.mockResolvedValue([
      createStatusRow(),
      createStatusRow(["status-2", "project-1", "done", "Done", 2, 1]),
    ]);

    const statuses = await repository.findAllStatuses();

    expect(statuses).toHaveLength(2);
    expect(statuses[0]?.key).toBe("todo");
    expect(statuses[1]?.isDone).toBe(true);
    expect(statuses[1]?.projectId).toBe("project-1");
  });

  it("finds a workflow status by id or returns null", async () => {
    database.query
      .mockResolvedValueOnce([createStatusRow()])
      .mockResolvedValueOnce([]);

    await expect(repository.findStatusById("status-1")).resolves.toMatchObject({
      id: "status-1",
      key: "todo",
    });
    await expect(repository.findStatusById("missing")).resolves.toBeNull();
  });

  it("finds milestones by project IDs including empty projectIds check", async () => {
    await expect(repository.findMilestonesByProjectIds([])).resolves.toEqual(
      [],
    );

    database.query.mockResolvedValue([createMilestoneRow()]);

    const result = await repository.findMilestonesByProjectIds(["project-1"]);

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Release v1.0");
    expect(result[0]?.status).toBe("open");
  });

  it("finds milestone by id or returns null", async () => {
    database.query
      .mockResolvedValueOnce([createMilestoneRow()])
      .mockResolvedValueOnce([]);

    await expect(
      repository.findMilestoneById("milestone-1"),
    ).resolves.toMatchObject({
      id: "milestone-1",
      name: "Release v1.0",
    });
    await expect(repository.findMilestoneById("missing")).resolves.toBeNull();
  });

  it("returns an existing project key or creates and confirms a new one", async () => {
    database.query.mockResolvedValueOnce([["PAGE"]]);

    await expect(
      repository.findOrCreateProjectKey("project-1", "PAGE"),
    ).resolves.toBe("PAGE");

    database.query.mockResolvedValueOnce([]).mockResolvedValueOnce([["ASTRO"]]);
    database.execute.mockResolvedValue(undefined);

    await expect(
      repository.findOrCreateProjectKey("project-2", "ASTRO"),
    ).resolves.toBe("ASTRO");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO project_keys"),
      { key: "ASTRO", project_id: "project-2" },
    );

    database.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      repository.findOrCreateProjectKey("project-3", "ANI"),
    ).resolves.toBe("ANI");
  });

  it("gets the next sequential ticket number for a project", async () => {
    database.query.mockResolvedValueOnce([[12]]).mockResolvedValueOnce([]);

    await expect(repository.getNextNumber("project-1")).resolves.toBe(12);
    await expect(repository.getNextNumber("project-2")).resolves.toBe(1);
  });

  it("returns all work items matching various filter options", async () => {
    await expect(repository.findAll({ projectIds: [] })).resolves.toEqual([]);

    database.query.mockResolvedValue([createWorkItemRow()]);

    const items = await repository.findAll({
      assigneeId: "user-1",
      milestoneId: "milestone-1",
      priority: WORK_ITEM_PRIORITY.HIGH,
      projectIds: ["project-1"],
      search: "board",
      statusId: "status-1",
      type: WORK_ITEM_TYPE.TASK,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe("PAGE-1");
    expect(items[0]?.progressPercentage).toBe(50);

    const defaultItems = await repository.findAll();
    expect(defaultItems).toHaveLength(1);

    await repository.findAll({ search: "   " });
  });

  it("finds a single work item by id or key", async () => {
    database.query
      .mockResolvedValueOnce([createWorkItemRow()])
      .mockResolvedValueOnce([]);

    await expect(repository.findById("item-1")).resolves.toMatchObject({
      id: "item-1",
      key: "PAGE-1",
    });
    await expect(repository.findById("missing")).resolves.toBeNull();

    database.query
      .mockResolvedValueOnce([createWorkItemRow()])
      .mockResolvedValueOnce([]);

    await expect(repository.findByKey("PAGE-1")).resolves.toMatchObject({
      key: "PAGE-1",
    });
    await expect(repository.findByKey("missing")).resolves.toBeNull();
  });

  it("finds subtasks for a parent item", async () => {
    database.query.mockResolvedValue([createWorkItemRow()]);

    const subtasks = await repository.findSubtasks("item-1");

    expect(subtasks).toHaveLength(1);
  });

  it("inserts and updates work items", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.insert({
      assigneeId: "user-1",
      createdBy: "user-1",
      description: "Desc",
      dueAt: "2026-05-01",
      id: "item-1",
      key: "PAGE-1",
      milestoneId: "milestone-1",
      number: 1,
      parentId: null,
      priority: WORK_ITEM_PRIORITY.NORMAL,
      projectId: "project-1",
      sortOrder: 1,
      startAt: "2026-04-01",
      statusId: "status-1",
      title: "Task 1",
      type: WORK_ITEM_TYPE.TASK,
    });

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO work_items"),
      expect.objectContaining({ key: "PAGE-1", title: "Task 1" }),
    );

    await repository.update("item-1", {
      assigneeId: null,
      description: "Updated desc",
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: WORK_ITEM_PRIORITY.URGENT,
      reporterId: "user-1",
      startAt: null,
      statusId: "status-2",
      title: "Updated task",
    });

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE work_items"),
      expect.objectContaining({ id: "item-1", title: "Updated task" }),
    );
  });

  it("updates status and order for kanban drag and drop", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.updateStatusAndOrder("item-1", "status-done", 3, true);
    await repository.updateStatusAndOrder("item-1", "status-todo", 1, false);

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("completed_at = CASE WHEN $is_done = 1"),
      expect.objectContaining({ id: "item-1", is_done: 1, sort_order: 3 }),
    );
  });

  it("archives a work item", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.archive("item-1");

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("archived_at = CURRENT_TIMESTAMP"),
      { id: "item-1" },
    );
  });

  it("inserts and finds history records", async () => {
    database.execute.mockResolvedValue(undefined);
    database.query.mockResolvedValue([createHistoryRow()]);

    await repository.insertHistory({
      action: "status_changed",
      field: "status",
      id: "hist-1",
      newValue: "In Arbeit",
      oldValue: "To Do",
      userId: "user-1",
      workItemId: "item-1",
    });

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO work_item_history"),
      expect.objectContaining({ action: "status_changed" }),
    );

    const history = await repository.findHistoryByWorkItemId("item-1");

    expect(history).toHaveLength(1);
    expect(history[0]?.action).toBe("status_changed");
    expect(history[0]?.userDisplayName).toBe("Admin");
  });

  it("finds eligible assignees for a project", async () => {
    database.query.mockResolvedValue([
      ["user-1", "admin", "Admin User", ROLE.ADMIN, 1],
      ["user-2", "employee", "Team Member", ROLE.EMPLOYEE, 1],
    ]);

    const assignees = await repository.findEligibleAssignees("project-1");

    expect(assignees).toHaveLength(2);
    expect(assignees[0]?.displayName).toBe("Admin User");
    expect(assignees[1]?.role).toBe(ROLE.EMPLOYEE);
  });

  it("rejects invalid work item type and priority from row", async () => {
    const invalidTypeRow = [...createWorkItemRow()];
    invalidTypeRow[4] = "invalid-type";
    database.query.mockResolvedValueOnce([invalidTypeRow]);

    await expect(repository.findById("item-1")).rejects.toThrow(
      'unsupported work item type "invalid-type"',
    );

    const invalidPriorityRow = [...createWorkItemRow()];
    invalidPriorityRow[9] = "invalid-priority";
    database.query.mockResolvedValueOnce([invalidPriorityRow]);

    await expect(repository.findById("item-1")).rejects.toThrow(
      'unsupported priority "invalid-priority"',
    );
  });

  it("persists GitHub links and conflict flags", async () => {
    database.execute.mockResolvedValue(undefined);
    database.query.mockResolvedValue([createWorkItemRow()]);

    const linked = await repository.findLinkedWorkItems("project-1");

    expect(linked).toHaveLength(1);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("github_issue_number IS NOT NULL"),
      { project_id: "project-1" },
    );

    await repository.updateGitHubLink("item-1", {
      conflict: true,
      contentHash: "hash-value",
      issueNumber: 82,
      issueState: "open",
      issueUpdatedAt: "2026-09-05T14:20:00.000Z",
      issueUrl: "https://github.com/user/pages/issues/82",
      lastSyncAt: "2026-09-05T14:21:00.000Z",
    });

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("github_issue_number = $github_issue_number"),
      expect.objectContaining({ github_conflict: 1, github_issue_number: 82 }),
    );

    await repository.setGitHubConflict("item-1", false);

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("github_conflict = $github_conflict"),
      { id: "item-1", github_conflict: 0 },
    );

    await repository.updateGitHubLink("item-1", {
      conflict: false,
      contentHash: null,
      issueNumber: null,
      issueState: null,
      issueUpdatedAt: null,
      issueUrl: null,
      lastSyncAt: null,
    });

    expect(database.execute).toHaveBeenLastCalledWith(
      expect.stringContaining("github_issue_number = $github_issue_number"),
      expect.objectContaining({ github_conflict: 0 }),
    );

    await repository.setGitHubConflict("item-1", true);

    expect(database.execute).toHaveBeenLastCalledWith(
      expect.stringContaining("github_conflict = $github_conflict"),
      { id: "item-1", github_conflict: 1 },
    );
  });

  it("rejects invalid GitHub issue states from row", async () => {
    const invalidRow = [...createWorkItemRow()];
    invalidRow[31] = "weird";
    database.query.mockResolvedValueOnce([invalidRow]);

    await expect(repository.findById("item-1")).rejects.toThrow(
      'unsupported GitHub issue state "weird"',
    );
  });

  it("rejects invalid user role from row", async () => {
    database.query.mockResolvedValueOnce([
      ["user-1", "admin", "Admin User", "superadmin", 1],
    ]);

    await expect(repository.findEligibleAssignees("project-1")).rejects.toThrow(
      'unsupported role "superadmin"',
    );
  });

  it("maps milestone, work item, and history rows with null vs non-null branches", async () => {
    database.query.mockResolvedValueOnce([
      createMilestoneRow([
        "milestone-1",
        "project-1",
        "Release",
        "Desc",
        "completed",
        null,
        null,
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
        "2026-01-04",
      ]),
      createMilestoneRow([
        "milestone-2",
        "project-1",
        "Release 2",
        "Desc",
        "archived",
        "2026-01-01",
        "2026-01-02",
        "2026-01-01",
        "2026-01-02",
        null,
        null,
      ]),
    ]);

    const milestones = await repository.findMilestonesByProjectIds([
      "project-1",
    ]);
    expect(milestones[0]?.status).toBe("completed");
    expect(milestones[0]?.startAt).toBeNull();
    expect(milestones[0]?.completedAt).toBe("2026-01-03");
    expect(milestones[1]?.status).toBe("archived");

    const fullItemRow = [
      "item-full",
      "project-1",
      "PAGE-10",
      10,
      WORK_ITEM_TYPE.EPIC,
      "parent-id",
      "Full Title",
      "Full Desc",
      "status-done",
      WORK_ITEM_PRIORITY.URGENT,
      "user-1",
      "user-1",
      "milestone-1",
      "2026-08-01",
      1,
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "Pages",
      "done",
      "Done",
      1,
      "User Name",
      "Milestone Name",
      "Parent Title",
      "PAGE-1",
      0,
      0,
      82,
      "https://github.com/user/pages/issues/82",
      "closed",
      "2026-09-05T14:20:00.000Z",
      "hash-value",
      1,
      "2026-09-05T14:21:00.000Z",
      "Reporter Name",
      "2026-02-01",
      null,
    ];

    database.query.mockResolvedValueOnce([fullItemRow]);

    const fullItem = await repository.findById("item-full");
    expect(fullItem?.progressPercentage).toBe(100);
    expect(fullItem?.parentId).toBe("parent-id");
    expect(fullItem?.parentKey).toBe("PAGE-1");
    expect(fullItem?.assigneeName).toBe("User Name");
    expect(fullItem?.reporterName).toBe("Reporter Name");
    expect(fullItem?.completedAt).toBe("2026-01-03");
    expect(fullItem?.archivedAt).toBe("2026-01-04");
    expect(fullItem?.githubIssueNumber).toBe(82);
    expect(fullItem?.githubIssueUrl).toBe(
      "https://github.com/user/pages/issues/82",
    );
    expect(fullItem?.githubIssueState).toBe("closed");
    expect(fullItem?.githubIssueUpdatedAt).toBe("2026-09-05T14:20:00.000Z");
    expect(fullItem?.githubContentHash).toBe("hash-value");
    expect(fullItem?.githubConflict).toBe(true);
    expect(fullItem?.githubLastSyncAt).toBe("2026-09-05T14:21:00.000Z");
    expect(fullItem?.startAt).toBe("2026-02-01");
    expect(fullItem?.githubLastError).toBeNull();

    const nullItemRow = [
      "item-null",
      "project-1",
      "PAGE-11",
      11,
      WORK_ITEM_TYPE.TASK,
      null,
      "Null Title",
      "Null Desc",
      "status-todo",
      WORK_ITEM_PRIORITY.NORMAL,
      null,
      "user-1",
      null,
      null,
      2,
      "2026-01-01",
      "2026-01-02",
      null,
      null,
      "Pages",
      "todo",
      "To Do",
      0,
      null,
      null,
      null,
      null,
      0,
      0,
      null,
      null,
      null,
      null,
      null,
      0,
      null,
      null,
      null,
      null,
    ];

    database.query.mockResolvedValueOnce([nullItemRow]);

    const nullItem = await repository.findById("item-null");
    expect(nullItem?.progressPercentage).toBe(0);
    expect(nullItem?.reporterName).toBeNull();
    expect(nullItem?.startAt).toBeNull();
    expect(nullItem?.githubLastError).toBeNull();
    expect(nullItem?.parentId).toBeNull();
    expect(nullItem?.assigneeId).toBeNull();
    expect(nullItem?.githubIssueNumber).toBeNull();
    expect(nullItem?.githubIssueUrl).toBeNull();
    expect(nullItem?.githubIssueState).toBeNull();
    expect(nullItem?.githubIssueUpdatedAt).toBeNull();
    expect(nullItem?.githubContentHash).toBeNull();
    expect(nullItem?.githubConflict).toBe(false);
    expect(nullItem?.githubLastSyncAt).toBeNull();

    const nullHistoryRow = [
      "hist-null",
      "item-1",
      "user-1",
      null,
      "created",
      null,
      null,
      null,
      "2026-01-01",
    ];

    database.query.mockResolvedValueOnce([nullHistoryRow]);

    const history = await repository.findHistoryByWorkItemId("item-1");
    expect(history[0]?.userDisplayName).toBeNull();
    expect(history[0]?.field).toBeNull();
    expect(history[0]?.oldValue).toBeNull();
    expect(history[0]?.newValue).toBeNull();
  });

  it("returns empty aggregates for empty project id lists", async () => {
    await expect(repository.countWorkItemsByProject([])).resolves.toEqual(
      new Map(),
    );
    await expect(repository.countLabelUsageByProjectIds([])).resolves.toEqual(
      new Map(),
    );
    await expect(
      repository.findEligibleAssigneesByProjectIds([]),
    ).resolves.toEqual(new Map());
  });

  it("returns an empty overview when the aggregate row is missing", async () => {
    database.query.mockResolvedValue([]);

    const overview = await repository.countWorkItemsOverview(["project-1"], {
      todayDate: "2026-09-07",
      userId: "user-1",
      weekAgoStart: "2026-08-31 00:00:00",
      yesterdayDate: "2026-09-06",
    });

    expect(overview).toEqual({
      assigned: 0,
      inProgress: 0,
      open: 0,
      openDelta: 0,
      overdue: 0,
      overdueDelta: 0,
    });
  });

  it("groups eligible assignees by project with the fallback branch", async () => {
    database.query.mockResolvedValue([
      ["user-3", "viewer", "Viewer User", ROLE.EMPLOYEE, 1, null],
    ]);

    const result = await repository.findEligibleAssigneesByProjectIds([
      "project-1",
    ]);

    expect(result.get("project-1")).toEqual([]);
  });

  it("manages checklist items", async () => {
    const checklistRow = [
      "check-1",
      "item-1",
      "Verify build",
      0,
      1,
      "2026-01-01",
      "2026-01-02",
    ];

    database.query.mockResolvedValue([checklistRow]);

    const items = await repository.findChecklistItemsByWorkItemId("item-1");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ isDone: false, title: "Verify build" });

    database.query
      .mockResolvedValueOnce([checklistRow])
      .mockResolvedValueOnce([]);

    await expect(
      repository.findChecklistItemById("check-1"),
    ).resolves.toMatchObject({ id: "check-1" });
    await expect(
      repository.findChecklistItemById("missing"),
    ).resolves.toBeNull();

    database.execute.mockResolvedValue(undefined);

    await repository.insertChecklistItem({
      id: "check-2",
      title: "Ship",
      workItemId: "item-1",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO work_item_checklist_items"),
      expect.objectContaining({ title: "Ship" }),
    );

    await repository.updateChecklistItem("check-1", {
      isDone: true,
      title: "Verify build",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("is_done = $is_done"),
      expect.objectContaining({ is_done: 1 }),
    );

    await repository.updateChecklistItem("check-1", {
      isDone: false,
      title: "Verify build",
    });
    expect(database.execute).toHaveBeenLastCalledWith(
      expect.stringContaining("is_done = $is_done"),
      expect.objectContaining({ is_done: 0 }),
    );

    await repository.deleteChecklistItem("check-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM work_item_checklist_items"),
      { id: "check-1" },
    );
  });

  it("manages work item links in both directions", async () => {
    database.query.mockResolvedValue([
      [
        "link-1",
        "relates_to",
        "outgoing",
        "item-2",
        "PAGE-2",
        "Second task",
        "todo",
        0,
        "2026-01-01",
      ],
      [
        "link-2",
        "blocks",
        "incoming",
        "item-3",
        "PAGE-3",
        "Third task",
        "todo",
        0,
        "2026-01-02",
      ],
    ]);

    const links = await repository.findLinksByWorkItemId("item-1");

    expect(links).toHaveLength(2);
    expect(links[0]?.direction).toBe("outgoing");
    expect(links[1]?.direction).toBe("incoming");

    database.query
      .mockResolvedValueOnce([["link-1", "item-1", "item-2", "blocks"]])
      .mockResolvedValueOnce([]);

    await expect(repository.findLinkById("link-1")).resolves.toMatchObject({
      linkType: "blocks",
    });
    await expect(repository.findLinkById("missing")).resolves.toBeNull();

    database.execute.mockResolvedValue(undefined);

    await repository.insertLink({
      id: "link-3",
      linkedWorkItemId: "item-2",
      linkType: "duplicates",
      workItemId: "item-1",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO work_item_links"),
      expect.objectContaining({ link_type: "duplicates" }),
    );

    await repository.deleteLink("link-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM work_item_links"),
      { id: "link-1" },
    );
  });

  it("rejects invalid link type and direction values", async () => {
    database.query.mockResolvedValueOnce([
      ["link-1", "item-1", "item-2", "weird"],
    ]);

    await expect(repository.findLinkById("link-1")).rejects.toThrow(
      'unsupported link type "weird"',
    );

    database.query.mockResolvedValueOnce([
      [
        "link-1",
        "weird",
        "outgoing",
        "item-2",
        "PAGE-2",
        "Second",
        "todo",
        0,
        "2026-01-01",
      ],
    ]);

    await expect(repository.findLinksByWorkItemId("item-1")).rejects.toThrow(
      'unsupported link type "weird"',
    );

    database.query.mockResolvedValueOnce([
      [
        "link-1",
        "relates_to",
        "sideways",
        "item-2",
        "PAGE-2",
        "Second",
        "todo",
        0,
        "2026-01-01",
      ],
    ]);

    await expect(repository.findLinksByWorkItemId("item-1")).rejects.toThrow(
      'unsupported link direction "sideways"',
    );
  });
});

describe("TaskRepository archived tickets", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: TaskRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new TaskRepository(database);
  });

  it("filters active, archived, and all tickets", async () => {
    database.query.mockResolvedValue([]);

    await repository.findAll({ projectIds: ["project-1"] });
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("work_items.archived_at IS NULL"),
      expect.anything(),
    );

    await repository.findAll({
      archived: "archived",
      projectIds: ["project-1"],
    });
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("work_items.archived_at IS NOT NULL"),
      expect.anything(),
    );

    await repository.findAll({ archived: "all" });
    const statement = vi.mocked(database.query).mock.calls.at(-1)?.[0] ?? "";

    expect(statement).not.toContain("work_items.archived_at IS");
  });

  it("restores archived tickets and records sync errors", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.restore("item-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("archived_at = NULL"),
      { id: "item-1" },
    );

    await repository.setGitHubError("item-1", "Forbidden");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("github_last_error = $github_last_error"),
      { github_last_error: "Forbidden", id: "item-1" },
    );

    await repository.setGitHubError("item-1", null);
    expect(database.execute).toHaveBeenLastCalledWith(
      expect.stringContaining("github_last_error = $github_last_error"),
      expect.objectContaining({ github_last_error: null }),
    );
  });

  it("moves tickets to another project with a new key", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.moveToProject("item-1", {
      assigneeId: null,
      key: "ASTRO-1",
      milestoneId: null,
      number: 1,
      parentId: null,
      projectId: "project-2",
    });

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("project_id = $project_id"),
      expect.objectContaining({
        id: "item-1",
        key: "ASTRO-1",
        project_id: "project-2",
      }),
    );
  });
});

describe("TaskRepository project labels", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: TaskRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new TaskRepository(database);
  });

  function createLabelRow(): readonly unknown[] {
    return [
      "label-1",
      "project-1",
      "Feature",
      "#3b82f6",
      "2026-01-01",
      "2026-01-02",
    ];
  }

  it("manages the project label catalog", async () => {
    database.query.mockResolvedValue([createLabelRow()]);

    const labels = await repository.findLabelsByProjectId("project-1");
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ color: "#3b82f6", name: "Feature" });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM project_labels"),
      { project_id: "project-1" },
    );

    database.query.mockResolvedValueOnce([createLabelRow()]);
    await expect(repository.findLabelById("label-1")).resolves.toMatchObject({
      id: "label-1",
    });

    database.query.mockResolvedValueOnce([]);
    await expect(repository.findLabelById("missing")).resolves.toBeNull();

    database.execute.mockResolvedValue(undefined);
    await repository.insertLabel({
      color: "#ef4444",
      id: "label-2",
      name: "Bug",
      projectId: "project-1",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO project_labels"),
      expect.objectContaining({ name: "Bug" }),
    );

    await repository.updateLabel("label-1", {
      color: "#a855f7",
      name: "Feature Request",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE project_labels"),
      expect.objectContaining({ name: "Feature Request" }),
    );

    await repository.deleteLabel("label-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM work_item_labels"),
      { label_id: "label-1" },
    );
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM project_labels"),
      { id: "label-1" },
    );
  });

  it("counts label usage and manages assignments", async () => {
    database.query.mockResolvedValue([[7]]);
    expect(await repository.countLabelUsage("label-1")).toBe(7);

    database.query.mockResolvedValue([]);
    expect(await repository.countLabelUsage("missing")).toBe(0);

    database.execute.mockResolvedValue(undefined);
    await repository.assignLabel("item-1", "label-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO work_item_labels"),
      { label_id: "label-1", work_item_id: "item-1" },
    );

    await repository.unassignLabel("item-1", "label-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM work_item_labels"),
      expect.objectContaining({ label_id: "label-1" }),
    );

    await repository.removeAllLabelsFromWorkItem("item-1");
    expect(database.execute).toHaveBeenLastCalledWith(
      expect.stringContaining("DELETE FROM work_item_labels"),
      { work_item_id: "item-1" },
    );
  });

  it("maps labels by work item", async () => {
    const empty = await repository.findLabelsForWorkItemIds([]);
    expect(empty.size).toBe(0);
    expect(database.query).not.toHaveBeenCalled();

    database.query.mockResolvedValue([
      ["item-1", ...createLabelRow()],
      [
        "item-1",
        "label-2",
        "project-1",
        "Bug",
        "#ef4444",
        "2026-01-01",
        "2026-01-02",
      ],
      ["item-2", ...createLabelRow()],
    ]);

    const mapped = await repository.findLabelsForWorkItemIds([
      "item-1",
      "item-2",
    ]);
    expect(mapped.get("item-1")).toHaveLength(2);
    expect(mapped.get("item-2")).toHaveLength(1);
    expect(mapped.get("item-1")?.[0]?.name).toBe("Feature");
  });
});
