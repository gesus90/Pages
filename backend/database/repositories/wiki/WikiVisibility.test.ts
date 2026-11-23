import { expect, it } from "vitest";

import { createInCondition, createVisiblePagesQuery } from "./WikiVisibility";

import type { WikiVisibilityScope } from "@/definition/Wiki";

const scope: WikiVisibilityScope = {
  userId: "viewer",
  isAdmin: false,
  canReadPrivate: false,
  projectIds: ["p1", "p2"],
  departmentIds: ["d1"],
};

it("builds an IN condition with one placeholder per value", () => {
  expect(createInCondition("col", "v", ["a", "b"])).toEqual({
    sql: "col IN ($v_0, $v_1)",
    parameters: { v_0: "a", v_1: "b" },
  });
});

it("builds a false condition for an empty list", () => {
  expect(createInCondition("col", "v", [])).toEqual({
    sql: "FALSE",
    parameters: {},
  });
});

it("builds the visible pages query for a plain viewer", () => {
  const query = createVisiblePagesQuery(scope);

  expect(query.sql).toContain("page.deleted_at IS NULL");
  expect(query.parameters).toMatchObject({
    viewer_id: "viewer",
    viewer_management: 0,
    viewer_is_admin: 0,
    visible_project_0: "p1",
    visible_project_1: "p2",
    visible_department_0: "d1",
    visible_milestone_project_1: "p2",
    visible_epic_project_0: "p1",
    visible_epic_department_0: "d1",
  });
});

it("includes the trash and the management flags on request", () => {
  const query = createVisiblePagesQuery(
    { ...scope, isAdmin: true, canReadPrivate: true },
    { includeDeleted: true },
  );

  expect(query.sql).not.toContain("page.deleted_at IS NULL");
  expect(query.parameters).toMatchObject({
    viewer_management: 1,
    viewer_is_admin: 1,
  });
});
