import { expect, it, vi } from "vitest";

import { TaskHistoryRecorder } from "./TaskHistoryRecorder";

import type { WorkItemUpdateValues } from "./TaskHistoryRecorder";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { User } from "@/definition/User";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const actor = doubleOf<User>({ id: "u1" });
const status = doubleOf<WorkflowStatus>({ id: "s1", name: "Open" });

function setup(): {
  readonly recorder: TaskHistoryRecorder;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
} {
  const repository = {
    findAssigneeGroupById: vi.fn(async () => ({ name: "Group" })),
    findById: vi.fn(async () => ({ key: "P-9" })),
    findEligibleAssignees: vi.fn(async () => [
      { displayName: "Ann", id: "a1" },
    ]),
    findMilestoneById: vi.fn(async () => ({ name: "M" })),
    insertHistory: vi.fn(async () => {}),
  };

  return {
    recorder: new TaskHistoryRecorder(doubleOf<TaskRepository>(repository)),
    repository,
  };
}

function entries(
  repository: Record<string, ReturnType<typeof vi.fn>>,
): object[] {
  return repository.insertHistory.mock.calls.map(
    (call: unknown[]) => call[0] as object,
  );
}

const existing = doubleOf<WorkItemDetail>({
  assigneeGroupId: null,
  assigneeGroupName: "Old group",
  assigneeId: null,
  assigneeName: null,
  createdBy: "r0",
  description: "d",
  dueAt: null,
  githubIssueNumber: null,
  id: "w1",
  milestoneId: null,
  milestoneName: "Old M",
  parentId: null,
  parentKey: "P-1",
  priority: "low",
  projectName: "Proj",
  reporterName: "Rep",
  statusId: "s1",
  statusName: "Open",
  title: "t",
});

const unchanged: WorkItemUpdateValues = {
  assigneeGroupId: null,
  assigneeId: null,
  description: "d",
  dueAt: null,
  milestoneId: null,
  newStatus: status,
  parentId: null,
  priority: "low",
  reporterId: "r0",
  startAt: null,
  title: "t",
};

it("records the plain lifecycle entries", async () => {
  const { recorder, repository } = setup();

  await recorder.recordCreated(actor, "w1");
  await recorder.recordArchived(actor, "w1");
  await recorder.recordRestored(actor, "w1");

  expect(entries(repository)).toEqual([
    expect.objectContaining({ action: "created", userId: "u1" }),
    expect.objectContaining({ action: "archived", workItemId: "w1" }),
    expect.objectContaining({ action: "restored", field: null }),
  ]);
});

it("records department, label and milestone link entries", async () => {
  const { recorder, repository } = setup();

  await recorder.recordDepartmentChanged(actor, "w1", {
    newName: "B",
    oldName: "A",
  });
  await recorder.recordLabelAdded(actor, "w1", "bug");
  await recorder.recordLabelRemoved(actor, "w1", "bug");
  await recorder.recordMilestoneLinked(actor, "w1", "M");
  await recorder.recordMilestoneUnlinked(actor, "w1", "M");
  await recorder.recordMilestoneAdopted(actor, "w1", "M");
  await recorder.recordGitHubSyncFailed(actor, "w1", "boom");

  expect(
    entries(repository).map((entry) => (entry as { action: string }).action),
  ).toEqual([
    "department_changed",
    "label_added",
    "label_removed",
    "milestone_initiative_added",
    "milestone_initiative_removed",
    "milestone_changed",
    "github_sync_failed",
  ]);
  expect(entries(repository)[0]).toMatchObject({
    newValue: "B",
    oldValue: "A",
  });
});

it("records a status move only when the status differs", async () => {
  const { recorder, repository } = setup();

  await recorder.recordStatusMove(actor, existing, status);
  await recorder.recordStatusMove(
    actor,
    existing,
    doubleOf<WorkflowStatus>({ id: "s2", name: "Done" }),
  );

  expect(entries(repository)).toEqual([
    expect.objectContaining({ newValue: "Done", oldValue: "Open" }),
  ]);
});

it("records a project move with and without a GitHub issue", async () => {
  const { recorder, repository } = setup();

  await recorder.recordProjectMove(actor, existing, "Target");
  await recorder.recordProjectMove(
    actor,
    doubleOf<WorkItemDetail>({ ...existing, githubIssueNumber: 7 }),
    "Target",
  );

  expect(entries(repository)).toEqual([
    expect.objectContaining({ action: "project_changed", oldValue: "Proj" }),
    expect.objectContaining({ action: "project_changed" }),
    expect.objectContaining({ action: "github_unlinked", oldValue: "#7" }),
  ]);
});

it("records a new title and description", async () => {
  const { recorder, repository } = setup();

  await recorder.recordTitleChanged(actor, existing, "n");
  await recorder.recordDescriptionChanged(actor, existing, "nd");

  expect(entries(repository)).toEqual([
    expect.objectContaining({ newValue: "n", oldValue: "t" }),
    expect.objectContaining({ newValue: "nd", oldValue: "d" }),
  ]);
});

it("records a new parent with its key or none", async () => {
  const { recorder, repository } = setup();

  await recorder.recordParentChanged(actor, {
    newParentId: "p9",
    oldParentKey: "P-1",
    workItemId: "w1",
  });
  await recorder.recordParentChanged(actor, {
    newParentId: null,
    oldParentKey: "P-1",
    workItemId: "w1",
  });

  expect(entries(repository)).toEqual([
    expect.objectContaining({ newValue: "P-9", oldValue: "P-1" }),
    expect.objectContaining({ newValue: null, oldValue: "P-1" }),
  ]);
});

it("records nothing for an unchanged update", async () => {
  const { recorder, repository } = setup();

  await recorder.recordUpdate(actor, existing, unchanged);

  expect(repository.insertHistory).not.toHaveBeenCalled();
});

it("records every changed field of an update", async () => {
  const { recorder, repository } = setup();

  await recorder.recordUpdate(actor, existing, {
    assigneeGroupId: null,
    assigneeId: "a1",
    description: "d2",
    dueAt: "2026-01-01",
    milestoneId: "m1",
    newStatus: doubleOf<WorkflowStatus>({ id: "s2", name: "Done" }),
    parentId: "p9",
    priority: "high",
    reporterId: "a1",
    startAt: null,
    title: "t2",
  });

  expect(
    entries(repository).map((entry) => (entry as { action: string }).action),
  ).toEqual([
    "title_changed",
    "description_changed",
    "status_changed",
    "priority_changed",
    "assignee_changed",
    "reporter_changed",
    "parent_changed",
    "milestone_changed",
    "due_at_changed",
  ]);
  expect(entries(repository)[4]).toMatchObject({
    newValue: "Ann",
    oldValue: "Old group",
  });
});

it("names a group assignee and tolerates unknown references", async () => {
  const { recorder, repository } = setup();

  repository.findAssigneeGroupById.mockResolvedValueOnce(null);
  await recorder.recordUpdate(actor, existing, {
    ...unchanged,
    assigneeGroupId: "g1",
  });
  await recorder.recordUpdate(actor, existing, {
    ...unchanged,
    assigneeGroupId: "g1",
  });
  await recorder.recordUpdate(
    actor,
    doubleOf<WorkItemDetail>({ ...existing, assigneeName: "Person" }),
    { ...unchanged, assigneeId: "nobody", reporterId: "nobody" },
  );

  expect(entries(repository)).toEqual([
    expect.objectContaining({ newValue: null }),
    expect.objectContaining({ newValue: "Group" }),
    expect.objectContaining({ newValue: null, oldValue: "Person" }),
    expect.objectContaining({ action: "reporter_changed", newValue: null }),
  ]);
});

it("records the removal of a parent and a milestone", async () => {
  const { recorder, repository } = setup();

  await recorder.recordUpdate(
    actor,
    doubleOf<WorkItemDetail>({
      ...existing,
      milestoneId: "m1",
      parentId: "p1",
    }),
    unchanged,
  );

  expect(entries(repository)).toEqual([
    expect.objectContaining({ action: "parent_changed", newValue: null }),
    expect.objectContaining({ action: "milestone_changed", newValue: null }),
  ]);
});
