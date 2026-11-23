import { describe, expect, it } from "vitest";

import { createWorkItemVisibility } from "./WorkItemVisibility";

describe("createWorkItemVisibility", () => {
  it("permits everything without a scope", () => {
    expect(createWorkItemVisibility(undefined)).toEqual({
      condition: "1 = 1",
      parameters: {},
    });
  });

  it("permits every department when the department list is null", () => {
    expect(createWorkItemVisibility({ departmentIds: null })).toEqual({
      condition: "1 = 1",
      parameters: {},
    });
  });

  it("permits only tickets without department for an empty list", () => {
    const fragment = createWorkItemVisibility({ departmentIds: [] }, "parent");

    expect(fragment.condition).toContain("NOT EXISTS");
    expect(fragment.condition).toContain(
      "ticket_department.work_item_id = parent.id",
    );
    expect(fragment.condition).not.toContain("IN (");
    expect(fragment.parameters).toEqual({});
  });

  it("adds the own departments as bound values", () => {
    const fragment = createWorkItemVisibility({ departmentIds: ["a", "b"] });

    expect(fragment.condition).toContain(
      "IN ($visible_department_id_0, $visible_department_id_1)",
    );
    expect(fragment.condition).toContain("work_items.id");
    expect(fragment.parameters).toEqual({
      visible_department_id_0: "a",
      visible_department_id_1: "b",
    });
  });

  it("denies everything when no project is accessible", () => {
    expect(
      createWorkItemVisibility({ departmentIds: null, projectIds: [] }),
    ).toEqual({ condition: "1 = 0", parameters: {} });
  });

  it("combines departments with the accessible projects", () => {
    const fragment = createWorkItemVisibility(
      { departmentIds: ["d"], projectIds: ["p"] },
      "child",
    );

    expect(fragment.condition).toContain(
      "child.project_id IN ($visible_project_id_0)",
    );
    expect(fragment.parameters).toEqual({
      visible_department_id_0: "d",
      visible_project_id_0: "p",
    });
  });
});
