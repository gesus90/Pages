import { useState } from "react";

import { DEFAULT_TASK_FILTERS } from "@/app/lib/task-filters";

import type { TaskFilters } from "@/app/lib/task-filters";

/** The filters of the task views and the functions that change one of them. */
export interface TaskFilterState {
  readonly filters: TaskFilters;
  readonly setFilter: <Field extends keyof TaskFilters>(
    field: Field,
    value: TaskFilters[Field],
  ) => void;
}

/** Keeps what the task views are filtered by. */
export function useTaskFilters(): TaskFilterState {
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_TASK_FILTERS);

  return {
    filters,
    setFilter: (field, value) =>
      setFilters((current) => ({ ...current, [field]: value })),
  };
}
