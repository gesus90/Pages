import { EligibleAssigneeRepository } from "@/backend/database/repositories/task/EligibleAssigneeRepository";
import { createInClause } from "@/backend/database/repositories/task/InClause";
import { MilestoneRepository } from "@/backend/database/repositories/task/MilestoneRepository";
import { MilestoneDependencyRepository } from "@/backend/database/repositories/task/MilestoneDependencyRepository";
import { MilestoneInitiativeRepository } from "@/backend/database/repositories/task/MilestoneInitiativeRepository";
import {
  readOptionalCountColumn,
  readOptionalTextColumn,
} from "@/backend/database/repositories/task/OptionalColumn";
import { TaskLabelRepository } from "@/backend/database/repositories/task/TaskLabelRepository";
import { toWorkItemDetail } from "@/backend/database/repositories/task/WorkItemDetailMapper";
import {
  createWorkItemConditionStatement,
  createWorkItemListStatement,
} from "@/backend/database/repositories/task/WorkItemDetailStatement";
import { buildWorkItemFilter } from "@/backend/database/repositories/task/WorkItemFilter";
import { WorkItemCountRepository } from "@/backend/database/repositories/task/WorkItemCountRepository";
import { WorkItemQueryRepository } from "@/backend/database/repositories/task/WorkItemQueryRepository";
import { snapshotParameters } from "@/backend/database/repositories/task/WorkItemSnapshotSql";
import { createWorkItemVisibility } from "@/backend/database/repositories/task/WorkItemVisibility";
import { WorkflowStatusRepository } from "@/backend/database/repositories/task/WorkflowStatusRepository";

import { agentTransactionScope } from "@/backend/service/agents/AgentTransactionScope";

import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
} from "./world";

import type { FindWorkItemsOptions } from "@/backend/database/repositories/task/WorkItemFilter";
import type { WorkItemVisibility } from "@/definition/Task";
import type { RepositoryFlow, RepositoryStep } from "./world";

const PROJECT = "project-a";
const OTHER_PROJECT = "project-b";

const SAME_DEPARTMENT: WorkItemVisibility = {
  departmentIds: ["department-a"],
  projectIds: [PROJECT],
};

const NO_DEPARTMENT: WorkItemVisibility = { departmentIds: [] };

const NO_PROJECT: WorkItemVisibility = { departmentIds: null, projectIds: [] };

const OVERVIEW_SCOPE = {
  userId: "user-admin",
  todayDate: "2026-07-01",
  weekAgoStart: "2026-01-01 00:00:00",
  yesterdayDate: "2026-06-30",
};

/**
 * Every row shares its sort keys with another one, and `tie-a` moves to the end
 * of the table in PostgreSQL only, so a missing last sort key shows as a difference.
 */
const TICKET_ROWS = `
  INSERT INTO work_items (
      id, project_id, key, number, type, parent_id, title, description, status_id, priority,
      assignee_id, assignee_group_id, created_by, milestone_id, due_at,
      sort_order, created_at, updated_at, archived_at, github_issue_number
  )
  VALUES
      ('tie-c', 'project-a', 'TIE-3', 1, 'task', NULL, 'Gleich', '100% fertig', 'status-todo', 'normal',
       NULL, NULL, 'user-admin', NULL, NULL,
       5, '2026-01-01 00:00:00', '2026-01-01 00:00:00', NULL, 12),
      ('tie-a', 'project-a', 'TIE-1', 2, 'epic', NULL, 'Gleich', 'Text', 'status-todo', 'high',
       'user-manager', NULL, 'user-admin', 'mile-c', '2026-05-01',
       5, '2026-01-01 00:00:00', '2026-01-01 00:00:00', NULL, 11),
      ('tie-b', 'project-a', 'TIE-2', 3, 'task', 'tie-a', 'Pfad C:\\Temp\\', 'hundert fertig', 'status-in-progress', 'normal',
       NULL, 'group-b', 'user-admin', NULL, NULL,
       5, '2026-01-01 00:00:00', '2026-01-01 00:00:00', NULL, 14),
      ('tie-d', 'project-a', 'TIE-4', 4, 'subtask', 'tie-a', 'Ähnlich', 'Text', 'status-done', 'low',
       'user-admin', NULL, 'user-admin', NULL, '2026-05-01',
       5, '2026-01-01 00:00:00', '2026-01-01 00:00:00', NULL, 10),
      ('tie-x', 'project-a', 'TIE-5', 5, 'task', NULL, 'Archiviert', 'Text', 'status-todo', 'normal',
       NULL, NULL, 'user-admin', NULL, NULL,
       6, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-02-01 00:00:00', 13),
      ('tie-y', 'project-a', 'TIE-6', 6, 'initiative', NULL, 'Initiative', 'Text', 'status-todo', 'normal',
       NULL, NULL, 'user-admin', 'mile-c', NULL,
       7, '2026-01-01 00:00:00', '2026-01-01 00:00:00', NULL, NULL),
      ('tie-o', 'project-b', 'OTH-1', 1, 'task', NULL, 'Anderes Projekt', 'Text', 'status-todo', 'normal',
       NULL, NULL, 'user-admin', NULL, NULL,
       5, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-02-01 00:00:00', NULL),
      ('tie-q', 'project-b', 'OTH-2', 2, 'task', NULL, 'Aktiv', 'Text', 'status-done', 'normal',
       NULL, NULL, 'user-admin', NULL, NULL,
       5, '2026-01-01 00:00:00', '2026-01-01 00:00:00', NULL, NULL);
  INSERT INTO work_item_departments (work_item_id, department_id)
  VALUES ('tie-a', 'department-a'), ('tie-b', 'department-z');
  UPDATE work_items SET updated_at = '2026-01-01 00:00:00' WHERE id = 'tie-a';
`;

/** What may stand in a due date, because the ticket services store it as given. */
const ODD_DUE_DATES: Readonly<Record<string, string>> = {
  "due-1": "2026-06-30",
  "due-2": "2026-7-1",
  "due-3": "2026-07-01T10:00:00Z",
  "due-4": "2026-07-02",
  "due-5": "2026-02-30",
  "due-6": "morgen",
  "due-7": "Jan 1 2026",
  "due-8": "20260601",
};

const LIST_OPTIONS: readonly FindWorkItemsOptions[] = [
  { projectIds: [PROJECT] },
  { projectIds: [] },
  { projectIds: [PROJECT], orderBy: "due_asc" },
  { projectIds: [PROJECT], orderBy: "due_nulls_last" },
  { projectIds: [PROJECT], orderBy: "updated_desc" },
  { projectIds: [PROJECT], limit: 2 },
  { projectIds: [PROJECT, OTHER_PROJECT], archived: "archived" },
  { projectIds: [PROJECT, OTHER_PROJECT], archived: "all" },
  { archived: "archived", archivedProjectIds: [] },
  { projectIds: [PROJECT], archived: "all", archivedProjectIds: [] },
  { archived: "archived", archivedProjectIds: [OTHER_PROJECT] },
  { projectIds: [PROJECT], archived: "all", archivedProjectIds: [PROJECT] },
  { projectIds: [PROJECT], assigneeId: "user-manager" },
  { projectIds: [PROJECT], assigneeGroupId: "group-b" },
  { projectIds: [PROJECT], assignedToUserId: "user-admin" },
  { projectIds: [PROJECT], type: "subtask" },
  { projectIds: [PROJECT], statusId: "status-done" },
  { projectIds: [PROJECT], priority: "high" },
  { projectIds: [PROJECT], milestoneId: "mile-c" },
  { projectIds: [PROJECT], parentId: "tie-a" },
  { projectIds: [PROJECT], departmentId: "department-z" },
  { projectIds: [PROJECT], labelIds: ["label-read"] },
  { projectIds: [PROJECT], labelIds: [] },
  { projectIds: [PROJECT], openOnly: true },
  { projectIds: [PROJECT], hasDueDate: true },
  { projectIds: [PROJECT], visibility: SAME_DEPARTMENT },
  { projectIds: [PROJECT], visibility: NO_DEPARTMENT },
  { projectIds: [PROJECT], visibility: NO_PROJECT },
  { search: "ähnlich" },
  { search: "TIE-_" },
  { search: "c:\\temp\\" },
  { search: "%" },
  { search: "   " },
  { search: "100%", searchDescription: true },
  { search: "1_0", searchDescription: true },
  { search: "temp\\", searchDescription: true },
];

const MILESTONE_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO milestones (id, project_id, name, due_at, start_at, description, updated_at)
    VALUES
        ('mile-c', 'project-a', 'Gleich', '2026-03-01', NULL, NULL, '2026-01-01 00:00:00'),
        ('mile-a', 'project-a', 'Gleich', '2026-03-01', '2026-01-01', 'Text', '2026-01-01 00:00:00'),
        ('mile-n', 'project-a', 'Ohne', NULL, NULL, 'Text', '2026-01-01 00:00:00');
  `),
  reversedInPostgres("milestones"),
  call("MilestoneRepository.findByProjectIds", ({ database }) =>
    new MilestoneRepository(database).findByProjectIds([PROJECT]),
  ),
  call("MilestoneRepository.findByProjectIds", ({ database }) =>
    new MilestoneRepository(database).findByProjectIds([]),
  ),
  call("MilestoneRepository.findById", ({ database }) =>
    new MilestoneRepository(database).findById("mile-c"),
  ),
  ...(
    [
      ["name", "Gleich", "Neuer Name"],
      ["name", "Neuer Name", "Gleich"],
      ["description", "", "Gefüllt"],
      ["description", "falsch", "Abgelehnt"],
      ["status", "open", "completed"],
      ["status", "completed", "open"],
      ["startAt", null, "2026-01-05"],
      ["startAt", "2026-01-05", null],
      ["startAt", "falsch", null],
      ["dueAt", "2026-03-01", null],
      ["dueAt", null, "2026-03-01"],
    ] as const
  ).map(([field, base, value]) =>
    call("MilestoneRepository.updateField", ({ database }) =>
      new MilestoneRepository(database).updateField("mile-c", {
        field,
        base,
        value,
      }),
    ),
  ),
  call("MilestoneRepository.update", ({ database }) =>
    new MilestoneRepository(database).update("mile-n", {
      name: "Ohne",
      description: "Abgeschlossen",
      status: "completed",
      dueAt: null,
      colorCustom: "#112233",
    }),
  ),
  call("MilestoneRepository.findById", ({ database }) =>
    new MilestoneRepository(database).findById("mile-n"),
  ),
  refused("MilestoneRepository.update", ({ database }) =>
    new MilestoneRepository(database).update("mile-n", {
      name: MISSING_TEXT,
      description: "",
      status: "open",
      dueAt: null,
    }),
  ),
  prepare(`
    INSERT INTO milestone_dependencies (id, project_id, source_id, target_id, link_type, created_at)
    VALUES
        ('dep-c', 'project-a', 'mile-a', 'mile-c', 'blocks', '2026-01-01 00:00:00'),
        ('dep-a', 'project-a', 'mile-a', 'mile-n', 'blocks', '2026-01-01 00:00:00');
  `),
  reversedInPostgres("milestone_dependencies"),
  call("MilestoneDependencyRepository.findByProjectIds", ({ database }) =>
    new MilestoneDependencyRepository(database).findByProjectIds([PROJECT]),
  ),
  call("MilestoneDependencyRepository.findByProjectIds", ({ database }) =>
    new MilestoneDependencyRepository(database).findByProjectIds([]),
  ),
  refused("MilestoneDependencyRepository.insert", ({ database }) =>
    new MilestoneDependencyRepository(database).insert({
      id: "dep-a",
      projectId: PROJECT,
      sourceId: "mile-a",
      targetId: "mile-c",
      linkType: "blocks",
    }),
  ),
];

const LIST_STEPS: readonly RepositoryStep[] = [
  prepare(TICKET_ROWS),
  ...LIST_OPTIONS.map((options) =>
    call("WorkItemQueryRepository.findAll", ({ database }) =>
      new WorkItemQueryRepository(database).findAll(options),
    ),
  ),
  call("WorkItemQueryRepository.findById", ({ database }) =>
    new WorkItemQueryRepository(database).findById("tie-b", SAME_DEPARTMENT),
  ),
  call("WorkItemQueryRepository.findById", ({ database }) =>
    new WorkItemQueryRepository(database).findById("tie-b", {
      departmentIds: null,
    }),
  ),
  call("WorkItemQueryRepository.findByKey", ({ database }) =>
    new WorkItemQueryRepository(database).findByKey("TIE-4", NO_DEPARTMENT),
  ),
  call("WorkItemQueryRepository.findParentReference", ({ database }) =>
    new WorkItemQueryRepository(database).findParentReference("tie-c"),
  ),
  call("WorkItemQueryRepository.findVisibleKeys", ({ database }) =>
    new WorkItemQueryRepository(database).findVisibleKeys(
      ["TIE-4", "TIE-2", "TIE-1", "TIE-3"],
      { departmentIds: null },
    ),
  ),
  call("WorkItemQueryRepository.findVisibleKeys", ({ database }) =>
    new WorkItemQueryRepository(database).findVisibleKeys([], NO_DEPARTMENT),
  ),
  call("WorkItemQueryRepository.findSubtasks", ({ database }) =>
    new WorkItemQueryRepository(database).findSubtasks("tie-a"),
  ),
  call("WorkItemQueryRepository.findLinkedWorkItems", ({ database }) =>
    new WorkItemQueryRepository(database).findLinkedWorkItems(PROJECT, {
      departmentIds: null,
    }),
  ),
  call("WorkItemQueryRepository.findArchivedLinkedWorkItems", ({ database }) =>
    new WorkItemQueryRepository(database).findArchivedLinkedWorkItems(PROJECT),
  ),
  call("WorkItemQueryRepository.findKnownGitHubIssueNumbers", ({ database }) =>
    new WorkItemQueryRepository(database).findKnownGitHubIssueNumbers(PROJECT),
  ),
  refusedWithoutTable(
    "WorkItemQueryRepository.findById",
    "workflow_statuses",
    (transaction) =>
      new WorkItemQueryRepository(agentTransactionScope(transaction)).findById(
        "tie-a",
      ),
  ),
  call("buildWorkItemFilter", () =>
    Promise.resolve(
      buildWorkItemFilter({ projectIds: [PROJECT], limit: 1, search: "a\\" }),
    ),
  ),
  call("createWorkItemListStatement", () =>
    Promise.resolve(
      createWorkItemListStatement({
        whereClause: "",
        orderClause: "ORDER BY work_items.id",
        limitClause: "",
        subtaskScope: "",
        parameters: {},
      }),
    ),
  ),
  call("createWorkItemConditionStatement", () =>
    Promise.resolve(
      createWorkItemConditionStatement("work_items.id = $id", SAME_DEPARTMENT),
    ),
  ),
  call("createWorkItemVisibility", () =>
    Promise.resolve(createWorkItemVisibility(SAME_DEPARTMENT, "parent")),
  ),
  call("createInClause", () =>
    Promise.resolve(createInClause("value", ["a", "b"])),
  ),
  call("snapshotParameters", () =>
    Promise.resolve(snapshotParameters(undefined)),
  ),
  call("readOptionalTextColumn", () =>
    Promise.resolve(readOptionalTextColumn(["a", null], 1, "value")),
  ),
  call("readOptionalCountColumn", () =>
    Promise.resolve(readOptionalCountColumn([1, null], 0, "value")),
  ),
  refused("readOptionalCountColumn", () =>
    Promise.resolve(readOptionalCountColumn(["a"], 0, "value")),
  ),
  refused("toWorkItemDetail", () => Promise.resolve(toWorkItemDetail([]))),
  call("toWorkItemDetail", async ({ database }) => {
    const [row] = await database.query(
      createWorkItemConditionStatement("work_items.id = $id"),
      { id: "tie-c" },
    );
    return row ? toWorkItemDetail(row) : null;
  }),
];

const COUNT_STEPS: readonly RepositoryStep[] = [
  call("WorkItemCountRepository.countOverview", ({ database }) =>
    new WorkItemCountRepository(database).countOverview(
      [PROJECT],
      OVERVIEW_SCOPE,
    ),
  ),
  call("WorkItemCountRepository.countOverview", ({ database }) =>
    new WorkItemCountRepository(database).countOverview(
      [PROJECT],
      OVERVIEW_SCOPE,
      SAME_DEPARTMENT,
    ),
  ),
  call("WorkItemCountRepository.countOverview", ({ database }) =>
    new WorkItemCountRepository(database).countOverview([], OVERVIEW_SCOPE),
  ),
  prepare(`
    INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by)
    VALUES
        ('count-1', 'project-c1', 'CNT-1', 1, 'task', 'Zähler', 'status-todo', 'user-admin'),
        ('count-2', 'project-c2', 'CNT-2', 1, 'task', 'Zähler', 'status-done', 'user-admin'),
        ('count-3', 'project-c3', 'CNT-3', 1, 'task', 'Zähler', 'status-todo', 'user-admin'),
        ('count-4', 'project-c4', 'CNT-4', 1, 'task', 'Zähler', 'status-done', 'user-admin');
  `),
  ...[1, 2].flatMap((): RepositoryStep[] => [
    reversedInPostgres("work_items"),
    call("WorkItemCountRepository.countByProject", ({ database }) =>
      new WorkItemCountRepository(database).countByProject([
        OTHER_PROJECT,
        PROJECT,
        "project-c1",
        "project-c2",
        "project-c3",
        "project-c4",
      ]),
    ),
  ]),
  prepare("DELETE FROM work_items WHERE id LIKE 'count-%';"),
  call("WorkItemCountRepository.countByProject", ({ database }) =>
    new WorkItemCountRepository(database).countByProject(
      [PROJECT],
      NO_DEPARTMENT,
    ),
  ),
  call("WorkItemCountRepository.countByProject", ({ database }) =>
    new WorkItemCountRepository(database).countByProject([]),
  ),
  refused("WorkItemCountRepository.countOverview", ({ database }) =>
    new WorkItemCountRepository(database).countOverview([PROJECT], {
      ...OVERVIEW_SCOPE,
      todayDate: "kein Datum",
    }),
  ),
  ...Object.entries(ODD_DUE_DATES).map(([id, dueAt], index) =>
    prepare(
      `
        INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by, due_at)
        VALUES ($id, 'project-b', $key, $number, 'task', 'Datum', 'status-todo', 'user-admin', $due_at);
      `,
      { id, key: `DUE-${String(index)}`, number: index + 10, due_at: dueAt },
    ),
  ),
  call("WorkItemCountRepository.countOverview", ({ database }) =>
    new WorkItemCountRepository(database).countOverview(
      [OTHER_PROJECT],
      OVERVIEW_SCOPE,
    ),
  ),
  ...[
    ...Object.values(ODD_DUE_DATES),
    "2026/06/30",
    "2026 06 30",
    " 2026-06-30 x",
    "2026-06-301",
    "epoch",
    "infinity",
    "-infinity",
    "today",
    "2026-06-30 (BC)",
    "-2026-06-30",
    "0-02-29",
    "",
  ].map((dueAt) =>
    call("stored", ({ database }) =>
      database.query(
        `
          SELECT
              CASE WHEN try_date($due_at) IS NULL THEN 'kein Datum' ELSE 'Datum' END,
              try_date($due_at) <= CAST('2026-07-01' AS DATE),
              try_date($due_at) >= CAST('2026-06-30' AS DATE);
        `,
        { due_at: dueAt },
      ),
    ),
  ),
];

const LABEL_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO labels (id, name, color)
    VALUES
        ('label-read', 'Lesen', '#000000'),
        ('label-zwei', 'Zwei', '#000000'),
        ('label-drei', 'Drei', '#000000'),
        ('label-vier', 'Vier', '#000000'),
        ('label-fuenf', 'Fünf', '#000000');
    INSERT INTO work_item_labels (work_item_id, label_id)
    VALUES
        ('tie-c', 'label-read'),
        ('tie-c', 'label-drei'),
        ('tie-a', 'label-read'),
        ('tie-a', 'label-zwei'),
        ('tie-a', 'label-drei'),
        ('tie-a', 'label-vier'),
        ('tie-a', 'label-fuenf');
  `),
  ...[1, 2].flatMap((): RepositoryStep[] => [
    reversedInPostgres("work_item_labels"),
    call("TaskLabelRepository.findByWorkItemIds", ({ database }) =>
      new TaskLabelRepository(database).findByWorkItemIds(["tie-c", "tie-a"]),
    ),
  ]),
  call("TaskLabelRepository.findByWorkItemIds", ({ database }) =>
    new TaskLabelRepository(database).findByWorkItemIds([]),
  ),
  call("TaskLabelRepository.countUsageByLabel", ({ database }) =>
    new TaskLabelRepository(database).countUsageByLabel(),
  ),
  call("TaskLabelRepository.countUsage", ({ database }) =>
    new TaskLabelRepository(database).countUsage("label-read", NO_DEPARTMENT),
  ),
];

const LOOKUP_STEPS: readonly RepositoryStep[] = [
  prepare(`
    INSERT INTO workflow_statuses (id, key, name, position, is_done)
    VALUES
        ('status-tie-z', 'tie-z', 'Gleich', 90, 0),
        ('status-tie-a', 'tie-a', 'Gleich', 90, 0);
    INSERT INTO users (id, username, display_name, password_hash, role)
    VALUES
        ('assignee-z', 'assignee-z', 'Gleicher Name', 'h', 'employee'),
        ('assignee-a', 'assignee-a', 'Gleicher Name', 'h', 'employee');
  `),
  reversedInPostgres("workflow_statuses"),
  reversedInPostgres("users"),
  call("WorkflowStatusRepository.findAll", ({ database }) =>
    new WorkflowStatusRepository(database).findAll(),
  ),
  refusedWithoutTable(
    "WorkflowStatusRepository.findById",
    "workflow_statuses",
    (transaction) =>
      new WorkflowStatusRepository(agentTransactionScope(transaction)).findById(
        "status-todo",
      ),
  ),
  call("EligibleAssigneeRepository.findCandidates", ({ database }) =>
    new EligibleAssigneeRepository(database).findCandidates(),
  ),
  call("EligibleAssigneeRepository.findByProjectIds", ({ database }) =>
    new EligibleAssigneeRepository(database).findByProjectIds([PROJECT]),
  ),
  call("EligibleAssigneeRepository.findByProjectIds", ({ database }) =>
    new EligibleAssigneeRepository(database).findByProjectIds([]),
  ),
  refusedWithoutTable(
    "EligibleAssigneeRepository.findCandidates",
    "users",
    (transaction) =>
      new EligibleAssigneeRepository(
        agentTransactionScope(transaction),
      ).findCandidates(),
  ),
];

const INITIATIVE_STEPS: readonly RepositoryStep[] = [
  prepare(`
    DELETE FROM workflow_statuses WHERE id LIKE 'status-tie-%';
    DELETE FROM users WHERE password_hash = 'h';
  `),
  call("MilestoneInitiativeRepository.insert", ({ database }) =>
    new MilestoneInitiativeRepository(database).insert("mile-a", "tie-y"),
  ),
  call("MilestoneInitiativeRepository.insert", ({ database }) =>
    new MilestoneInitiativeRepository(database).insert("mile-a", "tie-y"),
  ),
  refused("MilestoneInitiativeRepository.insert", ({ database }) =>
    new MilestoneInitiativeRepository(database).insert("mile-a", MISSING_TEXT),
  ),
  call("MilestoneInitiativeRepository.findByProjectIds", ({ database }) =>
    new MilestoneInitiativeRepository(database).findByProjectIds([PROJECT]),
  ),
  call("MilestoneInitiativeRepository.findByProjectIds", ({ database }) =>
    new MilestoneInitiativeRepository(database).findByProjectIds([]),
  ),
  call("MilestoneInitiativeRepository.countDependents", ({ database }) =>
    new MilestoneInitiativeRepository(database).countDependents(
      "tie-a",
      "mile-c",
    ),
  ),
  call("MilestoneInitiativeRepository.delete", ({ database }) =>
    new MilestoneInitiativeRepository(database).delete("mile-a", "tie-y"),
  ),
];

/** Lists, filters, counters and lookups of tickets, with sort keys that tie. */
export const TICKET_READ_FLOW: RepositoryFlow = {
  title: "ticket reads",
  steps: [
    ...MILESTONE_STEPS,
    ...LIST_STEPS,
    ...COUNT_STEPS,
    ...LABEL_STEPS,
    ...LOOKUP_STEPS,
    ...INITIATIVE_STEPS,
    prepare("DELETE FROM work_item_labels;"),
    prepare("DELETE FROM labels;"),
    prepare("DELETE FROM milestone_dependencies;"),
    prepare(
      "DELETE FROM work_item_departments; DELETE FROM work_items WHERE project_id IN ('project-a', 'project-b');",
    ),
    prepare("DELETE FROM milestones WHERE project_id = 'project-a';"),
  ],
};
