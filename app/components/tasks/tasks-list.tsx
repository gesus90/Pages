import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TasksListHead } from "./list/tasks-list-head";
import { TasksListRow } from "./list/tasks-list-row";

import type { Label, WorkItemDetail } from "@/definition/Task";
import type {
  TaskSortDirection,
  TaskSortField,
} from "./list/tasks-list-sorting";

export type { TaskSortField } from "./list/tasks-list-sorting";

interface TasksListProps {
  readonly workItems: readonly WorkItemDetail[];
  readonly selectedTaskId: string | null;
  readonly labelsByWorkItem?: Readonly<Record<string, readonly Label[]>>;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly sortField: TaskSortField;
  readonly sortDirection: TaskSortDirection;
  readonly onSortChange: (
    field: TaskSortField,
    direction: TaskSortDirection,
  ) => void;
}

// Rows rendered before progressive disclosure; the items arrive sorted, so
// the order stays correct while expanding.
const LIST_ROW_PAGE_SIZE = 100;

/** Renders a compact table of work items, in the order given; the column heads change the sort order. */
export function TasksList({
  workItems,
  selectedTaskId,
  labelsByWorkItem,
  onSelectTask,
  onOpenTask,
  sortField,
  sortDirection,
  onSortChange,
}: TasksListProps): React.ReactElement {
  const { t } = useTranslation();
  const [visibleRowCount, setVisibleRowCount] =
    useState<number>(LIST_ROW_PAGE_SIZE);
  const visibleItems = workItems.slice(0, visibleRowCount);
  const hiddenCount = workItems.length - visibleItems.length;

  function handleHeaderClick(field: TaskSortField): void {
    if (sortField === field) {
      onSortChange(field, sortDirection === "asc" ? "desc" : "asc");
    } else {
      onSortChange(field, "asc");
    }
  }

  function handleShowMore(): void {
    setVisibleRowCount((count) => count + LIST_ROW_PAGE_SIZE);
  }

  return (
    <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
      <table className="w-full text-left text-xs">
        <TasksListHead onSort={handleHeaderClick} />
        <tbody className="divide-y divide-muted/60">
          {visibleItems.map((item) => (
            <TasksListRow
              key={item.id}
              isSelected={
                item.id === selectedTaskId || item.key === selectedTaskId
              }
              item={item}
              labels={labelsByWorkItem?.[item.id] ?? []}
              onOpenTask={onOpenTask}
              onSelectTask={onSelectTask}
            />
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 ? (
        <button
          className="inline-flex min-h-10 w-full items-center justify-center px-4 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
          onClick={handleShowMore}
          type="button"
        >
          {t("tasks.view.showMore", { count: hiddenCount })}
        </button>
      ) : null}
    </div>
  );
}
