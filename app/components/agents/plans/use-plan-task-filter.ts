import { useState } from "react";

import type { AgentPlanTask } from "@/definition/AgentPlan";

type TaskSort = "key" | "title" | "statusName";

// Status filter values besides the statuses themselves, which use `status:<key>`.
const OPEN = "open";
const DONE = "done";
const STATUS_PREFIX = "status:";

/** One workflow status that occurs among the listed tickets. */
export interface PlanTaskStatus {
  readonly value: string;
  readonly name: string;
  readonly isDone: boolean;
}

/** Search, type, status and order of the ticket list, with the tickets they leave. */
export interface PlanTaskFilter {
  readonly tasks: readonly AgentPlanTask[];
  readonly statuses: readonly PlanTaskStatus[];
  readonly search: string;
  readonly setSearch: (search: string) => void;
  readonly type: string;
  readonly setType: (type: string) => void;
  readonly status: string;
  readonly setStatus: (status: string) => void;
  readonly sort: TaskSort;
  readonly setSort: (sort: TaskSort) => void;
}

/**
 * Tells whether a ticket's current status matches the filter.
 *
 * @param task - A listed ticket with its current workflow status.
 * @param filter - Empty for every ticket, `open` or `done` for the done flag of
 * the status, or `status:<key>` for one workflow status.
 */
export function matchesPlanTaskStatus(
  task: AgentPlanTask,
  filter: string,
): boolean {
  if (filter === OPEN) return !task.isDone;
  if (filter === DONE) return task.isDone;
  if (filter.startsWith(STATUS_PREFIX))
    return task.statusKey === filter.slice(STATUS_PREFIX.length);
  return true;
}

/** Lists each status once, open statuses before done ones. */
export function planTaskStatuses(
  tasks: readonly AgentPlanTask[],
): readonly PlanTaskStatus[] {
  const statuses = new Map<string, PlanTaskStatus>();
  for (const task of tasks)
    statuses.set(task.statusKey, {
      value: `${STATUS_PREFIX}${task.statusKey}`,
      name: task.statusName,
      isDone: task.isDone,
    });
  return [...statuses.values()].sort(
    (first, second) =>
      Number(first.isDone) - Number(second.isDone) ||
      first.name.localeCompare(second.name),
  );
}

/** Filters the authorized ticket list on the client; the list itself stays unchanged. */
export function usePlanTaskFilter(
  tasks: readonly AgentPlanTask[],
): PlanTaskFilter {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<TaskSort>("key");
  const query = search.toLowerCase();
  const filtered = tasks
    .filter(
      (task) =>
        `${task.key} ${task.title} ${task.statusName}`
          .toLowerCase()
          .includes(query) &&
        (!type || task.type === type) &&
        matchesPlanTaskStatus(task, status),
    )
    .sort(
      (first, second) =>
        first[sort].localeCompare(second[sort], undefined, { numeric: true }) ||
        first.id.localeCompare(second.id),
    );
  return {
    tasks: filtered,
    statuses: planTaskStatuses(tasks),
    search,
    setSearch,
    type,
    setType,
    status,
    setStatus,
    sort,
    setSort,
  };
}
