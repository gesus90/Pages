import { call, MISSING_TEXT, prepare, refused, stored } from "./world";

import type { WorkItemVisibility } from "@/definition/Task";
import type { RepositoryFlow, RepositoryStep } from "./world";

const PROJECT = "project-a";
const OTHER_PROJECT = "project-b";

const ITEM = {
  projectId: PROJECT,
  departmentId: null,
  type: "task",
  parentId: null,
  description: "Text",
  statusId: "status-todo",
  priority: "normal",
  assigneeId: null,
  assigneeGroupId: null,
  createdBy: "user-admin",
  milestoneId: null,
  dueAt: null,
  startAt: null,
  sortOrder: 0,
} as const;

const UPDATE = {
  title: "Neu",
  description: "Neu beschrieben",
  statusId: "status-todo",
  priority: "high",
  assigneeId: "user-manager",
  assigneeGroupId: null,
  reporterId: "user-admin",
  parentId: null,
  milestoneId: null,
  dueAt: "2026-06-01",
  startAt: null,
} as const;

const SCOPE: WorkItemVisibility = {
  departmentIds: ["department-a"],
  projectIds: [PROJECT],
};

const OVERVIEW_SCOPE = {
  userId: "user-manager",
  todayDate: "2026-07-01",
  weekAgoStart: "2026-06-24 00:00:00",
  yesterdayDate: "2026-06-30",
};

const MOVE = {
  projectId: OTHER_PROJECT,
  key: "MOVED-1",
  number: 1,
  parentId: null,
  milestoneId: null,
  assigneeId: null,
};

const STATUS_AND_MILESTONE_STEPS: readonly RepositoryStep[] = [
  call("TaskRepository.findAllStatuses", ({ tasks }) =>
    tasks.findAllStatuses(),
  ),
  call("TaskRepository.findStatusById", ({ tasks }) =>
    tasks.findStatusById("status-todo"),
  ),
  call("TaskRepository.findStatusById", ({ tasks }) =>
    tasks.findStatusById("nothing"),
  ),
  call("TaskRepository.insertMilestone", ({ tasks }) =>
    tasks.insertMilestone({
      id: "milestone-b",
      projectId: PROJECT,
      name: "Zweiter",
      description: "",
      dueAt: "2026-09-01",
    }),
  ),
  call("TaskRepository.insertMilestone", ({ tasks }) =>
    tasks.insertMilestone({
      id: "milestone-a",
      projectId: PROJECT,
      name: "Erster",
      description: "Mit Farbe",
      startAt: "2026-01-01",
      dueAt: null,
      colorKey: "team",
      iconKey: null,
      colorCustom: null,
    }),
  ),
  refused("TaskRepository.insertMilestone", ({ tasks }) =>
    tasks.insertMilestone({
      id: "milestone-a",
      projectId: PROJECT,
      name: "Doppelt",
      description: "",
      dueAt: null,
    }),
  ),
  call("TaskRepository.findMilestonesByProjectIds", ({ tasks }) =>
    tasks.findMilestonesByProjectIds([PROJECT]),
  ),
  call("TaskRepository.findMilestoneById", ({ tasks }) =>
    tasks.findMilestoneById("milestone-a"),
  ),
  call("TaskRepository.updateMilestone", ({ tasks }) =>
    tasks.updateMilestone("milestone-b", {
      name: "Zweiter neu",
      description: "Neu",
      status: "open",
      dueAt: "2026-10-01",
    }),
  ),
  call("TaskRepository.updateMilestoneField", ({ tasks }) =>
    tasks.updateMilestoneField("milestone-b", {
      field: "name",
      base: "Zweiter neu",
      value: "Zweiter feld",
    }),
  ),
  call("TaskRepository.updateMilestoneField", ({ tasks }) =>
    tasks.updateMilestoneField("milestone-b", {
      field: "name",
      base: "veraltet",
      value: "abgelehnt",
    }),
  ),
  call("TaskRepository.insertDependency", ({ tasks }) =>
    tasks.insertDependency({
      id: "dependency-a",
      projectId: PROJECT,
      sourceId: "milestone-a",
      targetId: "milestone-b",
      linkType: "blocks",
    }),
  ),
  call("TaskRepository.insertDependency", ({ tasks }) =>
    tasks.insertDependency({
      id: "dependency-b",
      projectId: PROJECT,
      sourceId: "milestone-b",
      targetId: "milestone-a",
      linkType: "follows",
    }),
  ),
  call("TaskRepository.findDependenciesByProjectIds", ({ tasks }) =>
    tasks.findDependenciesByProjectIds([PROJECT]),
  ),
  call("TaskRepository.deleteDependency", ({ tasks }) =>
    tasks.deleteDependency("dependency-a"),
  ),
  call("TaskRepository.deleteDependenciesByMilestone", ({ tasks }) =>
    tasks.deleteDependenciesByMilestone("milestone-a"),
  ),
];

const WORK_ITEM_STEPS: readonly RepositoryStep[] = [
  call("TaskRepository.findOrCreateProjectKey", ({ tasks }) =>
    tasks.findOrCreateProjectKey(PROJECT, "CHK"),
  ),
  call("TaskRepository.findOrCreateProjectKey", ({ tasks }) =>
    tasks.findOrCreateProjectKey(PROJECT, "IGNORED"),
  ),
  call("TaskRepository.reserveNumbers", ({ tasks }) =>
    tasks.reserveNumbers(PROJECT, 5),
  ),
  call("TaskRepository.reserveNumbers", ({ tasks }) =>
    tasks.reserveNumbers(PROJECT, 2),
  ),
  call("TaskRepository.insert", ({ tasks }) =>
    tasks.insert({
      ...ITEM,
      id: "item-epic",
      key: "CHK-1",
      number: 1,
      type: "epic",
      title: "Epic",
    }),
  ),
  call("TaskRepository.insert", ({ tasks }) =>
    tasks.insert({
      ...ITEM,
      id: "item-a",
      key: "CHK-2",
      number: 2,
      title: "Älteres Ticket",
      parentId: "item-epic",
      assigneeId: "user-manager",
      milestoneId: "milestone-a",
      dueAt: "2026-06-01",
      sortOrder: 1,
    }),
  ),
  call("TaskRepository.insert", ({ tasks }) =>
    tasks.insert({
      ...ITEM,
      id: "item-b",
      key: "CHK-3",
      number: 3,
      title: "Zweites",
      priority: "urgent",
      departmentId: "department-a",
      sortOrder: 1,
    }),
  ),
  call("TaskRepository.insert", ({ tasks }) =>
    tasks.insert({
      ...ITEM,
      id: "item-hidden",
      key: "CHK-4",
      number: 4,
      title: "Verborgen",
      departmentId: "department-z",
    }),
  ),
  refused("TaskRepository.insert", ({ tasks }) =>
    tasks.insert({
      ...ITEM,
      id: "item-a",
      key: "CHK-9",
      number: 9,
      title: "Doppelte Kennung",
    }),
  ),
  refused("TaskRepository.insert", ({ tasks }) =>
    tasks.insert({
      ...ITEM,
      id: "item-x",
      key: "CHK-10",
      number: 10,
      title: MISSING_TEXT,
    }),
  ),
  prepare(
    "UPDATE work_items SET created_at = '2026-01-01 00:00:00', updated_at = '2026-01-02 00:00:00' WHERE project_id = 'project-a';",
  ),
  call("TaskRepository.findAll", ({ tasks }) =>
    tasks.findAll({ projectIds: [PROJECT] }),
  ),
  call("TaskRepository.findAll", ({ tasks }) =>
    tasks.findAll({
      projectIds: [PROJECT],
      visibility: SCOPE,
      search: "ÄLTERES",
      orderBy: "due_nulls_last",
      limit: 10,
    }),
  ),
  call("TaskRepository.findAll", ({ tasks }) =>
    tasks.findAll({ projectIds: [PROJECT], orderBy: "due_asc" }),
  ),
  call("TaskRepository.findAll", ({ tasks }) =>
    tasks.findAll({ projectIds: [PROJECT], orderBy: "updated_desc" }),
  ),
  call("TaskRepository.countWorkItemsOverview", ({ tasks }) =>
    tasks.countWorkItemsOverview([PROJECT], OVERVIEW_SCOPE),
  ),
  call("TaskRepository.countWorkItemsByProject", ({ tasks }) =>
    tasks.countWorkItemsByProject([PROJECT, OTHER_PROJECT]),
  ),
  call("TaskRepository.findById", ({ tasks }) => tasks.findById("item-a")),
  call("TaskRepository.findById", ({ tasks }) =>
    tasks.findById("item-hidden", SCOPE),
  ),
  call("TaskRepository.findByKey", ({ tasks }) => tasks.findByKey("CHK-2")),
  call("TaskRepository.findParentReference", ({ tasks }) =>
    tasks.findParentReference("item-a"),
  ),
  call("TaskRepository.findVisibleKeys", ({ tasks }) =>
    tasks.findVisibleKeys(["CHK-2", "CHK-4", "NONE-1"], SCOPE),
  ),
  call("TaskRepository.findSubtasks", ({ tasks }) =>
    tasks.findSubtasks("item-epic"),
  ),
  call("TaskRepository.updateGitHubLink", ({ tasks }) =>
    tasks.updateGitHubLink("item-b", {
      issueNumber: 5,
      issueUrl: "https://example.test/5",
      issueState: "open",
      issueUpdatedAt: "2026-01-01T00:00:00Z",
      contentHash: "hash",
      conflict: false,
      lastSyncAt: "2026-01-01T00:00:00Z",
    }),
  ),
  call("TaskRepository.setGitHubConflict", ({ tasks }) =>
    tasks.setGitHubConflict("item-b", true),
  ),
  call("TaskRepository.setGitHubError", ({ tasks }) =>
    tasks.setGitHubError("item-b", "Fehler"),
  ),
  call("TaskRepository.findLinkedWorkItems", ({ tasks }) =>
    tasks.findLinkedWorkItems(PROJECT),
  ),
  call("TaskRepository.findArchivedLinkedWorkItems", ({ tasks }) =>
    tasks.findArchivedLinkedWorkItems(PROJECT),
  ),
  call("TaskRepository.findKnownGitHubIssueNumbers", ({ tasks }) =>
    tasks.findKnownGitHubIssueNumbers(PROJECT),
  ),
];

const WORK_ITEM_CHANGE_STEPS: readonly RepositoryStep[] = [
  call("TaskRepository.update", ({ tasks }) => tasks.update("item-a", UPDATE)),
  call("TaskRepository.update", ({ tasks }) =>
    tasks.update("item-a", { ...UPDATE, baseDescription: "veraltet" }),
  ),
  // `update` is a listed gap until PAGE-215; the steps after it start from its result.
  prepare(`
    UPDATE work_items
    SET
        title = 'Neu',
        description = 'Neu beschrieben',
        priority = 'high',
        assignee_id = 'user-manager',
        parent_id = NULL,
        milestone_id = NULL,
        due_at = '2026-06-01'
    WHERE id = 'item-a';
  `),
  call("TaskRepository.updateFromGitHub", ({ tasks }) =>
    tasks.updateFromGitHub("item-b", {
      title: "Von GitHub",
      description: "Text von GitHub",
      statusId: "status-todo",
    }),
  ),
  call("TaskRepository.updateStatusAndOrder", ({ tasks }) =>
    tasks.updateStatusAndOrder("item-b", "status-done", 3, true),
  ),
  call("TaskRepository.updateDescription", ({ tasks }) =>
    tasks.updateDescription("item-a", "Dritter Text", "Neu beschrieben"),
  ),
  call("TaskRepository.updateDescription", ({ tasks }) =>
    tasks.updateDescription("item-a", "Abgelehnt", "veraltet"),
  ),
  call("TaskRepository.updateTitle", ({ tasks }) =>
    tasks.updateTitle("item-a", "Titel", "Neu"),
  ),
  call("TaskRepository.updateStatus", ({ tasks }) =>
    tasks.updateStatus(
      "item-a",
      { id: "status-in-progress", isDone: false },
      "status-todo",
    ),
  ),
  call("TaskRepository.replaceParent", ({ tasks }) =>
    tasks.replaceParent("item-a", "item-epic", null),
  ),
  call("TaskRepository.updateParent", ({ tasks }) =>
    tasks.updateParent("item-a", null),
  ),
  call("TaskRepository.setDepartment", ({ tasks }) =>
    tasks.setDepartment("item-a", "department-a"),
  ),
  call("TaskRepository.setDepartmentIfCurrent", ({ tasks }) =>
    tasks.setDepartmentIfCurrent("item-a", null, "department-a"),
  ),
  call("TaskRepository.setMilestoneIfEmpty", ({ tasks }) =>
    tasks.setMilestoneIfEmpty("item-b", "milestone-a"),
  ),
  call("TaskRepository.clearMilestone", ({ tasks }) =>
    tasks.clearMilestone("item-b", "milestone-a"),
  ),
  call("TaskRepository.linkInitiativeToMilestone", ({ tasks }) =>
    tasks.linkInitiativeToMilestone("milestone-a", "item-epic"),
  ),
  call("TaskRepository.findMilestoneInitiativeLinks", ({ tasks }) =>
    tasks.findMilestoneInitiativeLinks([PROJECT]),
  ),
  call("TaskRepository.countMilestoneDependents", ({ tasks }) =>
    tasks.countMilestoneDependents("item-epic", "milestone-a"),
  ),
  call("TaskRepository.unlinkInitiativeFromMilestone", ({ tasks }) =>
    tasks.unlinkInitiativeFromMilestone("milestone-a", "item-epic"),
  ),
  call("TaskRepository.insertHistory", ({ tasks }) =>
    tasks.insertHistory({
      id: "history-a",
      workItemId: "item-a",
      userId: "user-admin",
      action: "updated",
      field: "title",
      oldValue: null,
      newValue: "Titel",
    }),
  ),
  prepare("UPDATE work_item_history SET created_at = '2026-01-03 00:00:00';"),
  call("TaskRepository.findHistoryByWorkItemId", ({ tasks }) =>
    tasks.findHistoryByWorkItemId("item-a"),
  ),
  call("TaskRepository.findHistoryByProjectId", ({ tasks }) =>
    tasks.findHistoryByProjectId(PROJECT, SCOPE),
  ),
];

const LABEL_AND_CHECKLIST_STEPS: readonly RepositoryStep[] = [
  call("TaskRepository.insertLabel", ({ tasks }) =>
    tasks.insertLabel({ id: "label-b", name: "Zebra", color: "#111111" }),
  ),
  call("TaskRepository.insertLabel", ({ tasks }) =>
    tasks.insertLabel({ id: "label-a", name: "Äpfel", color: "#222222" }),
  ),
  refused("TaskRepository.insertLabel", ({ tasks }) =>
    tasks.insertLabel({ id: "label-c", name: "ZEBRA", color: "#333333" }),
  ),
  call("TaskRepository.findLabels", ({ tasks }) => tasks.findLabels()),
  call("TaskRepository.findLabelByName", ({ tasks }) =>
    tasks.findLabelByName("zebra"),
  ),
  call("TaskRepository.findLabelById", ({ tasks }) =>
    tasks.findLabelById("label-a"),
  ),
  call("TaskRepository.updateLabel", ({ tasks }) =>
    tasks.updateLabel("label-a", { name: "Birnen", color: "#444444" }),
  ),
  call("TaskRepository.assignLabel", ({ tasks }) =>
    tasks.assignLabel("item-a", "label-a"),
  ),
  call("TaskRepository.assignLabel", ({ tasks }) =>
    tasks.assignLabel("item-a", "label-b"),
  ),
  call("TaskRepository.findLabelsForWorkItemIds", ({ tasks }) =>
    tasks.findLabelsForWorkItemIds(["item-a", "item-b"]),
  ),
  call("TaskRepository.countLabelUsage", ({ tasks }) =>
    tasks.countLabelUsage("label-a", SCOPE),
  ),
  // Callers look labels up in this map; its order is not part of the result.
  call("TaskRepository.countLabelUsageByLabel", async ({ tasks }) =>
    [...(await tasks.countLabelUsageByLabel())].sort(([first], [second]) =>
      first.localeCompare(second),
    ),
  ),
  call("TaskRepository.unassignLabel", ({ tasks }) =>
    tasks.unassignLabel("item-a", "label-a"),
  ),
  call("TaskRepository.deleteLabel", ({ tasks }) =>
    tasks.deleteLabel("label-b"),
  ),
  call("TaskRepository.insertChecklistItem", ({ tasks }) =>
    tasks.insertChecklistItem({
      id: "check-a",
      workItemId: "item-a",
      title: "Erster",
    }),
  ),
  call("TaskRepository.insertChecklistItem", ({ tasks }) =>
    tasks.insertChecklistItem({
      id: "check-b",
      workItemId: "item-a",
      title: "Zweiter",
    }),
  ),
  call("TaskRepository.insertChecklistItem", ({ tasks }) =>
    tasks.insertChecklistItem({
      id: "check-c",
      workItemId: "item-a",
      title: "Dritter",
    }),
  ),
  call("TaskRepository.findChecklistItemsByWorkItemId", ({ tasks }) =>
    tasks.findChecklistItemsByWorkItemId("item-a"),
  ),
  call("TaskRepository.findChecklistItemById", ({ tasks }) =>
    tasks.findChecklistItemById("check-a"),
  ),
  call("TaskRepository.updateChecklistItem", ({ tasks }) =>
    tasks.updateChecklistItem("check-a", { title: "Neu", isDone: true }),
  ),
  call("TaskRepository.setChecklistItemDoneIfCurrent", ({ tasks }) =>
    tasks.setChecklistItemDoneIfCurrent("check-b", true, {
      title: "Zweiter",
      isDone: false,
    }),
  ),
  call("TaskRepository.deleteChecklistItemIfCurrent", ({ tasks }) =>
    tasks.deleteChecklistItemIfCurrent("check-c", {
      title: "Veraltet",
      isDone: false,
    }),
  ),
  call("TaskRepository.deleteChecklistItem", ({ tasks }) =>
    tasks.deleteChecklistItem("check-c"),
  ),
  call("TaskRepository.insertLink", ({ tasks }) =>
    tasks.insertLink({
      id: "link-a",
      workItemId: "item-a",
      linkedWorkItemId: "item-b",
      linkType: "relates_to",
    }),
  ),
  call("TaskRepository.findLinksByWorkItemId", ({ tasks }) =>
    tasks.findLinksByWorkItemId("item-a"),
  ),
  call("TaskRepository.findLinkById", ({ tasks }) =>
    tasks.findLinkById("link-a"),
  ),
  call("TaskRepository.deleteLink", ({ tasks }) => tasks.deleteLink("link-a")),
  call("TaskRepository.findEligibleAssignees", ({ tasks }) =>
    tasks.findEligibleAssignees(),
  ),
  call("TaskRepository.findEligibleAssigneesByProjectIds", ({ tasks }) =>
    tasks.findEligibleAssigneesByProjectIds([PROJECT]),
  ),
  call("TaskRepository.findAssigneeGroups", ({ tasks }) =>
    tasks.findAssigneeGroups(),
  ),
  call("TaskRepository.findAssigneeGroupsWithMembers", ({ tasks }) =>
    tasks.findAssigneeGroupsWithMembers(),
  ),
  call("TaskRepository.findAssigneeGroupById", ({ tasks }) =>
    tasks.findAssigneeGroupById("group-b"),
  ),
  call("TaskRepository.findGroupIdsByMember", ({ tasks }) =>
    tasks.findGroupIdsByMember("user-admin"),
  ),
];

const LIFECYCLE_STEPS: readonly RepositoryStep[] = [
  call("TaskRepository.moveToProject", ({ tasks }) =>
    tasks.moveToProject("item-hidden", MOVE),
  ),
  call("TaskRepository.findById", ({ tasks }) => tasks.findById("item-hidden")),
  call("TaskRepository.moveSubtreeIfCurrent", ({ tasks }) =>
    tasks.moveSubtreeIfCurrent("item-hidden", [
      {
        id: "item-hidden",
        move: { ...MOVE, key: "MOVED-2", number: 2 },
        expected: {
          projectId: PROJECT,
          githubIssueNumber: null,
          fields: {
            title: "Verborgen",
            statusId: "status-todo",
            priority: "normal",
            assigneeId: null,
            assigneeGroupId: null,
            reporterId: "user-admin",
            parentId: null,
            milestoneId: null,
            dueAt: null,
            startAt: null,
          },
        },
      },
    ]),
  ),
  call("TaskRepository.insert", ({ tasks }) =>
    tasks.insert({
      ...ITEM,
      id: "item-child",
      key: "CHK-20",
      number: 20,
      type: "subtask",
      parentId: "item-b",
      title: "Kind",
    }),
  ),
  call("TaskRepository.findSubtreeIds", ({ tasks }) =>
    tasks.findSubtreeIds("item-b"),
  ),
  call("TaskRepository.countDescendants", ({ tasks }) =>
    tasks.countDescendants("item-b"),
  ),
  call("TaskRepository.findSubtreeStorageNames", ({ tasks }) =>
    tasks.findSubtreeStorageNames("item-b"),
  ),
  call("TaskRepository.archiveMany", ({ tasks }) =>
    tasks.archiveMany(["item-child"]),
  ),
  call("TaskRepository.restoreMany", ({ tasks }) =>
    tasks.restoreMany(["item-child"]),
  ),
  call("TaskRepository.detachChildren", ({ tasks }) =>
    tasks.detachChildren("item-b", "active"),
  ),
  call("TaskRepository.deleteSubtree", ({ tasks }) =>
    tasks.deleteSubtree("item-child"),
  ),
  call("TaskRepository.archiveMilestone", ({ tasks }) =>
    tasks.archiveMilestone("milestone-b"),
  ),
  call("TaskRepository.findMilestoneById", ({ tasks }) =>
    tasks.findMilestoneById("milestone-b", { includeArchived: true }),
  ),
  stored("SELECT id, key, project_id FROM work_items ORDER BY id;"),
  prepare(
    "DELETE FROM work_items WHERE project_id IN ('project-a', 'project-b');",
  ),
  prepare("DELETE FROM milestones WHERE project_id = 'project-a';"),
  prepare("DELETE FROM labels;"),
];

/** The ticket facade over `task/`; its statements themselves belong to PAGE-215. */
export const TASK_FACADE_FLOW: RepositoryFlow = {
  title: "ticket facade",
  steps: [
    ...STATUS_AND_MILESTONE_STEPS,
    ...WORK_ITEM_STEPS,
    ...WORK_ITEM_CHANGE_STEPS,
    ...LABEL_AND_CHECKLIST_STEPS,
    ...LIFECYCLE_STEPS,
  ],
};
