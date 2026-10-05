import { createInClause } from "./InClause";

import type { WorkItemPriority, WorkItemType } from "@/definition/Task";

/** Sort orders supported when querying work items. */
type WorkItemsOrder = "board" | "updated_desc" | "due_asc" | "due_nulls_last";

/** Which work items are returned with respect to their archived state. */
type ArchivedScope = "active" | "archived" | "all";

/** Optional filters for querying work items. */
export interface FindWorkItemsOptions {
  readonly projectIds?: readonly string[];
  readonly assigneeId?: string;
  readonly type?: WorkItemType;
  readonly statusId?: string;
  readonly priority?: WorkItemPriority;
  readonly milestoneId?: string;
  readonly search?: string;
  readonly archived?: ArchivedScope;
  readonly openOnly?: boolean;
  readonly hasDueDate?: boolean;
  readonly orderBy?: WorkItemsOrder;
  readonly limit?: number;
}

/** SQL fragments and bound values derived from {@link FindWorkItemsOptions}. */
export interface WorkItemFilter {
  /** Empty, or one `WHERE` clause joining all conditions. */
  readonly whereClause: string;
  readonly orderClause: string;
  /** Empty, or the `LIMIT` clause that ends the statement. */
  readonly limitClause: string;
  /** Empty, or the condition that restricts the subtask counters to the same projects. */
  readonly subtaskScope: string;
  readonly parameters: Readonly<Record<string, string | number>>;
}

/** One `WHERE` condition together with the values it binds. */
interface FilterFragment {
  readonly condition: string;
  readonly parameters: Readonly<Record<string, string>>;
}

/** Options that filter by comparing one column with the given value. */
type EqualityOption =
  "assigneeId" | "type" | "statusId" | "priority" | "milestoneId";

interface EqualityFilter {
  readonly option: EqualityOption;
  readonly parameter: string;
  readonly condition: string;
}

/** The order of the Kanban board, which also orders single-item lookups. */
export const BOARD_ORDER_CLAUSE =
  "ORDER BY work_items.sort_order ASC, work_items.created_at DESC";

const CONDITION_SEPARATOR = "\n          AND ";

const ARCHIVED_CONDITIONS: Readonly<Record<ArchivedScope, readonly string[]>> =
  {
    active: ["work_items.archived_at IS NULL"],
    all: [],
    archived: ["work_items.archived_at IS NOT NULL"],
  };

/**
 * Maps every supported sort order to its ORDER BY fragment.
 *
 * @remarks
 * The fragments come from a fixed whitelist so callers can never inject
 * arbitrary SQL through the order option.
 */
const ORDER_CLAUSES: Readonly<Record<WorkItemsOrder, string>> = {
  board: BOARD_ORDER_CLAUSE,
  due_asc: "ORDER BY work_items.due_at ASC",
  due_nulls_last:
    "ORDER BY work_items.due_at IS NULL ASC, work_items.due_at ASC, work_items.updated_at DESC",
  updated_desc: "ORDER BY work_items.updated_at DESC",
};

const EQUALITY_FILTERS: readonly EqualityFilter[] = [
  {
    condition: "work_items.assignee_id = $assignee_id",
    option: "assigneeId",
    parameter: "assignee_id",
  },
  {
    condition: "work_items.type = $type",
    option: "type",
    parameter: "type",
  },
  {
    condition: "work_items.status_id = $status_id",
    option: "statusId",
    parameter: "status_id",
  },
  {
    condition: "work_items.priority = $priority",
    option: "priority",
    parameter: "priority",
  },
  {
    condition: "work_items.milestone_id = $milestone_id",
    option: "milestoneId",
    parameter: "milestone_id",
  },
];

function createProjectFragments(
  projectIds: readonly string[] | undefined,
): FilterFragment[] {
  if (!projectIds) {
    return [];
  }

  const { parameters, placeholders } = createInClause("project_id", projectIds);

  return [
    { condition: `work_items.project_id IN (${placeholders})`, parameters },
  ];
}

function createEqualityFragments(
  options: FindWorkItemsOptions,
): FilterFragment[] {
  const fragments: FilterFragment[] = [];

  for (const filter of EQUALITY_FILTERS) {
    const value = options[filter.option];

    if (value) {
      fragments.push({
        condition: filter.condition,
        parameters: { [filter.parameter]: value },
      });
    }
  }

  return fragments;
}

function createSearchFragments(search: string | undefined): FilterFragment[] {
  const term = search?.trim();

  if (!term) {
    return [];
  }

  return [
    {
      condition:
        "(LOWER(work_items.title) LIKE $search OR LOWER(work_items.key) LIKE $search)",
      parameters: { search: `%${term.toLowerCase()}%` },
    },
  ];
}

function createFlagFragments(options: FindWorkItemsOptions): FilterFragment[] {
  const fragments: FilterFragment[] = [];

  if (options.openOnly === true) {
    fragments.push({
      condition: "workflow_statuses.is_done = 0",
      parameters: {},
    });
  }

  if (options.hasDueDate === true) {
    fragments.push({
      condition: "work_items.due_at IS NOT NULL",
      parameters: {},
    });
  }

  return fragments;
}

function createSubtaskScope(projectIds: readonly string[] | undefined): string {
  if (!projectIds) {
    return "";
  }

  const { placeholders } = createInClause("project_id", projectIds);

  return `AND child.project_id IN (${placeholders})`;
}

/**
 * Translates the options of a work item query into SQL fragments.
 *
 * @param options - Filters, order, and limit requested by the caller.
 * @returns The fragments and the values they bind, or `null` when an empty
 * project list excludes every work item.
 */
export function buildWorkItemFilter(
  options: FindWorkItemsOptions,
): WorkItemFilter | null {
  if (options.projectIds?.length === 0) {
    return null;
  }

  const fragments = [
    ...createProjectFragments(options.projectIds),
    ...createEqualityFragments(options),
    ...createSearchFragments(options.search),
    ...createFlagFragments(options),
  ];
  const conditions = [
    ...ARCHIVED_CONDITIONS[options.archived ?? "active"],
    ...fragments.map((fragment) => fragment.condition),
  ];
  const parameters: Record<string, string | number> = {};

  for (const fragment of fragments) {
    Object.assign(parameters, fragment.parameters);
  }

  if (options.limit !== undefined) {
    parameters.limit = options.limit;
  }

  return {
    limitClause: options.limit === undefined ? "" : "LIMIT $limit;",
    orderClause: ORDER_CLAUSES[options.orderBy ?? "board"],
    parameters,
    subtaskScope: createSubtaskScope(options.projectIds),
    whereClause:
      conditions.length > 0
        ? `WHERE ${conditions.join(CONDITION_SEPARATOR)}`
        : "",
  };
}
