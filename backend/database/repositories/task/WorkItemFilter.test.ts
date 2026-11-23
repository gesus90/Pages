import { describe, expect, it } from "vitest";

import { BOARD_ORDER_CLAUSE, buildWorkItemFilter } from "./WorkItemFilter";

import type { WorkItemFilter } from "./WorkItemFilter";

function build(
  options: Parameters<typeof buildWorkItemFilter>[0],
): WorkItemFilter {
  const filter = buildWorkItemFilter(options);
  if (!filter) throw new Error("Expected a filter.");
  return filter;
}

describe("buildWorkItemFilter", () => {
  it("returns null for an empty project list", () => {
    expect(buildWorkItemFilter({ projectIds: [] })).toBeNull();
  });

  it("defaults to active items in board order without limit", () => {
    const filter = build({});

    expect(filter.whereClause).toBe("WHERE work_items.archived_at IS NULL");
    expect(filter.orderClause).toBe(BOARD_ORDER_CLAUSE);
    expect(filter.limitClause).toBe("");
    expect(filter.subtaskScope).toBe("");
    expect(filter.parameters).toEqual({});
  });

  it("leaves the where clause empty for all archived scopes", () => {
    expect(build({ archived: "all" }).whereClause).toBe("");
    expect(build({ archived: "archived" }).whereClause).toContain(
      "IS NOT NULL",
    );
  });

  it("binds equality filters", () => {
    const filter = build({
      assigneeId: "a",
      assigneeGroupId: "g",
      type: "task",
      statusId: "s",
      priority: "high",
      milestoneId: "m",
      parentId: "p",
      departmentId: "d",
    });

    expect(filter.parameters).toEqual({
      assignee_id: "a",
      assignee_group_id: "g",
      type: "task",
      status_id: "s",
      priority: "high",
      milestone_id: "m",
      parent_id: "p",
      department_id: "d",
    });
  });

  it("binds projects, labels, assigned user and limit", () => {
    const filter = build({
      projectIds: ["p1", "p2"],
      labelIds: ["l1"],
      assignedToUserId: "u",
      limit: 5,
      orderBy: "updated_desc",
    });

    expect(filter.parameters).toEqual({
      project_id_0: "p1",
      project_id_1: "p2",
      label_id_0: "l1",
      assigned_to_user_id: "u",
      limit: 5,
    });
    expect(filter.subtaskScope).toBe(
      "AND child.project_id IN ($project_id_0, $project_id_1)",
    );
    expect(filter.limitClause).toBe("LIMIT $limit;");
    expect(filter.orderClause).toContain("updated_at DESC");
  });

  it("ignores an empty label list", () => {
    expect(build({ labelIds: [] }).parameters).toEqual({});
  });

  it("knows the due date orders", () => {
    expect(build({ orderBy: "due_asc" }).orderClause).toContain("NULLS FIRST");
    expect(build({ orderBy: "due_nulls_last" }).orderClause).toContain(
      "due_at IS NULL ASC",
    );
  });

  it("adds visibility conditions", () => {
    const filter = build({ visibility: { departmentIds: ["d"] } });

    expect(filter.visibility).toEqual({ departmentIds: ["d"] });
    expect(filter.parameters).toEqual({ visible_department_id_0: "d" });
  });
});

describe("buildWorkItemFilter search and flags", () => {
  it("searches title and key with wildcards kept and backslashes doubled", () => {
    const filter = build({ search: "  A_b\\C " });

    expect(filter.parameters.search).toBe("%a_b\\\\c%");
    expect(filter.whereClause).not.toContain("description");
  });

  it("searches the description with literal wildcards", () => {
    const filter = build({ search: "50%_\\x", searchDescription: true });

    expect(filter.parameters.search).toBe("%50\\%\\_\\\\x%");
    expect(filter.whereClause).toContain("description");
  });

  it("does not search for blank text", () => {
    expect(build({ search: "   " }).parameters).toEqual({});
    expect(build({ searchDescription: true }).parameters).toEqual({});
  });

  it("adds the flag conditions", () => {
    const filter = build({ openOnly: true, hasDueDate: true });

    expect(filter.whereClause).toContain("workflow_statuses.is_done = 0");
    expect(filter.whereClause).toContain("work_items.due_at IS NOT NULL");
    expect(build({ openOnly: false, hasDueDate: false }).whereClause).toBe(
      "WHERE work_items.archived_at IS NULL",
    );
  });

  describe("archived project scope", () => {
    it("is ignored for the active scope or without a list", () => {
      expect(build({ archivedProjectIds: ["p"] }).parameters).toEqual({});
      expect(build({ archived: "all" }).parameters).toEqual({});
    });

    it("leaves no archived item for an empty list", () => {
      expect(
        build({ archived: "archived", archivedProjectIds: [] }).whereClause,
      ).toContain("1 = 0");
      expect(
        build({ archived: "all", archivedProjectIds: [] }).whereClause,
      ).toBe("WHERE work_items.archived_at IS NULL");
    });

    it("restricts archived items to the listed projects", () => {
      const archived = build({
        archived: "archived",
        archivedProjectIds: ["p"],
      });
      const all = build({ archived: "all", archivedProjectIds: ["p"] });

      expect(archived.parameters).toEqual({ archived_project_id_0: "p" });
      expect(archived.whereClause).toContain(
        "work_items.project_id IN ($archived_project_id_0)",
      );
      expect(all.whereClause).toContain(
        "(work_items.archived_at IS NULL OR work_items.project_id IN ($archived_project_id_0))",
      );
    });
  });
});
