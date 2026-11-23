import { describe, expect, it } from "vitest";

import {
  createWorkItemConditionStatement,
  createWorkItemListStatement,
} from "./WorkItemDetailStatement";

import type { WorkItemFilter } from "./WorkItemFilter";

const FILTER: WorkItemFilter = {
  whereClause: "WHERE FILTER_WHERE",
  orderClause: "ORDER BY FILTER_ORDER",
  limitClause: "LIMIT $limit;",
  subtaskScope: "AND SUBTASK_SCOPE",
  parameters: {},
};

describe("createWorkItemListStatement", () => {
  it("places the filter fragments around the shared select", () => {
    const statement = createWorkItemListStatement(FILTER);

    expect(statement).toContain("work_items.parent_id,");
    expect(statement).toContain("AND SUBTASK_SCOPE");
    expect(statement.indexOf("WHERE FILTER_WHERE")).toBeLessThan(
      statement.indexOf("ORDER BY FILTER_ORDER"),
    );
    expect(statement).toContain("LIMIT $limit;");
  });

  it("selects the visible parent when departments restrict reads", () => {
    const statement = createWorkItemListStatement({
      ...FILTER,
      visibility: { departmentIds: [] },
    });

    expect(statement).toContain("parent.id AS parent_id");
  });

  it("selects the visible parent when projects restrict reads", () => {
    const statement = createWorkItemListStatement({
      ...FILTER,
      visibility: { departmentIds: null, projectIds: ["p"] },
    });

    expect(statement).toContain("parent.id AS parent_id");
  });

  it("keeps the stored parent when the visibility allows everything", () => {
    const statement = createWorkItemListStatement({
      ...FILTER,
      visibility: { departmentIds: null },
    });

    expect(statement).toContain("work_items.parent_id,");
  });
});

describe("createWorkItemConditionStatement", () => {
  it("orders by the board and applies the condition and scope", () => {
    const statement = createWorkItemConditionStatement("work_items.id = $id");

    expect(statement).toContain("WHERE work_items.id = $id");
    expect(statement).toContain("AND 1 = 1");
    expect(statement).toContain("ORDER BY work_items.sort_order ASC");
  });

  it("adds the visibility of the actor", () => {
    const statement = createWorkItemConditionStatement("1 = 1", {
      departmentIds: [],
    });

    expect(statement).toContain("NOT EXISTS");
  });
});
