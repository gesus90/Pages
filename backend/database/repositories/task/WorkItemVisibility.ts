import { createInClause } from "./InClause";

import type { WorkItemVisibility } from "@/definition/Task";

/** Trusted aliases used by ticket queries and their joined relations. */
type WorkItemAlias = "work_items" | "parent" | "child" | "linked";

/** Department predicate and bound values shared by all ticket read queries. */
export interface WorkItemVisibilityFragment {
  readonly condition: string;
  readonly parameters: Readonly<Record<string, string>>;
}

/**
 * Limits a ticket alias to public tickets and the actor's own departments.
 *
 * @param visibility - Server-resolved scope; absent for trusted internal reads.
 * @param alias - Fixed query alias whose department column is checked.
 */
function createDepartmentVisibility(
  visibility: WorkItemVisibility | undefined,
  alias: WorkItemAlias,
): WorkItemVisibilityFragment {
  if (!visibility || visibility.departmentIds === null) {
    return { condition: "1 = 1", parameters: {} };
  }
  if (visibility.departmentIds.length === 0) {
    return { condition: `${alias}.department_id IS NULL`, parameters: {} };
  }
  const { parameters, placeholders } = createInClause(
    "visible_department_id",
    visibility.departmentIds,
  );
  return {
    condition: `(${alias}.department_id IS NULL OR ${alias}.department_id IN (${placeholders}))`,
    parameters,
  };
}

/** Combines current ticket departments with accessible projects for joined data. */
export function createWorkItemVisibility(
  visibility: WorkItemVisibility | undefined,
  alias: WorkItemAlias = "work_items",
): WorkItemVisibilityFragment {
  const departments = createDepartmentVisibility(visibility, alias);
  if (!visibility?.projectIds) return departments;
  if (visibility.projectIds.length === 0) {
    return { condition: "1 = 0", parameters: {} };
  }
  const projects = createInClause("visible_project_id", visibility.projectIds);
  return {
    condition: `(${departments.condition} AND ${alias}.project_id IN (${projects.placeholders}))`,
    parameters: { ...departments.parameters, ...projects.parameters },
  };
}
