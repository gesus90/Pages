import { describe, expect, it } from "vitest";

import { buildWorkItemFilter } from "@/backend/database/repositories/task/WorkItemFilter";

function whereClauseOf(
  options: Parameters<typeof buildWorkItemFilter>[0],
): string {
  return buildWorkItemFilter(options)?.whereClause ?? "";
}

describe("work item filter for archived work items of chosen projects", () => {
  it("leaves the scopes untouched without a project list", () => {
    expect(whereClauseOf({ archived: "archived" })).toBe(
      "WHERE work_items.archived_at IS NOT NULL",
    );
    expect(whereClauseOf({ archived: "all" })).toBe("");
    expect(whereClauseOf({})).toBe("WHERE work_items.archived_at IS NULL");
  });

  it("keeps every active work item and adds the archived ones of the listed projects", () => {
    const filter = buildWorkItemFilter({
      archived: "all",
      archivedProjectIds: ["p1", "p2"],
    });

    expect(filter?.whereClause).toBe(
      "WHERE (work_items.archived_at IS NULL OR work_items.project_id IN ($archived_project_id_0, $archived_project_id_1))",
    );
    expect(filter?.parameters).toEqual({
      archived_project_id_0: "p1",
      archived_project_id_1: "p2",
    });
  });

  it("returns only the archived work items of the listed projects", () => {
    const filter = buildWorkItemFilter({
      archived: "archived",
      archivedProjectIds: ["p1"],
    });

    expect(filter?.whereClause).toBe(
      "WHERE work_items.archived_at IS NOT NULL\n          AND work_items.project_id IN ($archived_project_id_0)",
    );
    expect(filter?.parameters).toEqual({ archived_project_id_0: "p1" });
  });

  it("leaves no archived work item at all for an empty list", () => {
    expect(whereClauseOf({ archived: "all", archivedProjectIds: [] })).toBe(
      "WHERE work_items.archived_at IS NULL",
    );
    expect(
      whereClauseOf({ archived: "archived", archivedProjectIds: [] }),
    ).toBe("WHERE work_items.archived_at IS NOT NULL\n          AND 1 = 0");
  });

  it("ignores the list when only active work items are asked for", () => {
    expect(
      whereClauseOf({ archived: "active", archivedProjectIds: ["p1"] }),
    ).toBe("WHERE work_items.archived_at IS NULL");
    expect(whereClauseOf({ archivedProjectIds: ["p1"] })).toBe(
      "WHERE work_items.archived_at IS NULL",
    );
  });
});
