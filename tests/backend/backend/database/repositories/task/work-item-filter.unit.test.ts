import { expect, it } from "vitest";

import {
  BOARD_ORDER_CLAUSE,
  buildWorkItemFilter,
} from "@/backend/database/repositories/task/WorkItemFilter";

it("defaults to active board order and returns no results for an empty project scope", () => {
  expect(buildWorkItemFilter({})).toMatchObject({
    whereClause: "WHERE work_items.archived_at IS NULL",
    orderClause: BOARD_ORDER_CLAUSE,
    limitClause: "",
    parameters: {},
  });
  expect(buildWorkItemFilter({ projectIds: [] })).toBeNull();
});

it("binds filters and scopes subtask counts to the same projects", () => {
  const result = buildWorkItemFilter({
    projectIds: ["project"],
    assigneeId: "person",
    assigneeGroupId: "group",
    assignedToUserId: "user",
    type: "task",
    statusId: "status",
    priority: "high",
    milestoneId: "mile",
    parentId: "parent",
    departmentId: "department",
    labelIds: ["label"],
    openOnly: true,
    hasDueDate: true,
    limit: 20,
    orderBy: "updated_desc",
  });
  expect(result?.parameters).toMatchObject({
    project_id_0: "project",
    assignee_id: "person",
    assignee_group_id: "group",
    assigned_to_user_id: "user",
    type: "task",
    status_id: "status",
    priority: "high",
    milestone_id: "mile",
    parent_id: "parent",
    department_id: "department",
    label_id_0: "label",
    limit: 20,
  });
  expect(result?.whereClause).toContain("workflow_statuses.is_done = 0");
  expect(result?.whereClause).toContain("work_items.due_at IS NOT NULL");
  expect(result?.subtaskScope).toContain("child.project_id IN");
  expect(result?.limitClause).toBe("LIMIT $limit;");
  expect(result?.orderClause).toContain("work_items.updated_at DESC");
});

it("restricts archived items to allowed projects without dropping active items", () => {
  expect(
    buildWorkItemFilter({ archived: "all", archivedProjectIds: ["allowed"] })
      ?.whereClause,
  ).toContain("work_items.archived_at IS NULL OR work_items.project_id IN");
  expect(
    buildWorkItemFilter({ archived: "all", archivedProjectIds: [] })
      ?.whereClause,
  ).toContain("work_items.archived_at IS NULL");
  expect(
    buildWorkItemFilter({ archived: "archived", archivedProjectIds: [] })
      ?.whereClause,
  ).toContain("1 = 0");
  expect(
    buildWorkItemFilter({
      archived: "archived",
      archivedProjectIds: ["allowed"],
    })?.parameters,
  ).toMatchObject({ archived_project_id_0: "allowed" });
});

it("escapes wildcards for description searches and preserves ordinary search wildcards", () => {
  const literal = buildWorkItemFilter({
    search: "  A%_\\B  ",
    searchDescription: true,
  });
  expect(literal?.parameters.search).toBe("%a\\%\\_\\\\b%");
  expect(literal?.whereClause).toContain("LOWER(work_items.description)");
  const wildcard = buildWorkItemFilter({ search: " A%_B " });
  expect(wildcard?.parameters.search).toBe("%a%_b%");
  expect(wildcard?.whereClause).not.toContain("LOWER(work_items.description)");
  expect(buildWorkItemFilter({ search: " " })?.parameters).toEqual({});
});

it.each(["due_asc", "due_nulls_last"] as const)(
  "selects a predefined due-date order: %s",
  (orderBy) => {
    expect(buildWorkItemFilter({ orderBy })?.orderClause).toContain(
      "work_items.due_at",
    );
  },
);
