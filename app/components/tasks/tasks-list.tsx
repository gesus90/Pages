import { ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  TaskPriorityBadge,
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { TaskLabelList } from "@/app/components/tasks/task-labels";

import type {
  ProjectLabel,
  WorkItemDetail,
  WorkItemPriority,
} from "@/definition/Task";

export type TaskSortField =
  "updated" | "priority" | "dueDate" | "project" | "status" | "title";

interface TasksListProps {
  readonly workItems: readonly WorkItemDetail[];
  readonly selectedTaskId: string | null;
  readonly labelsByWorkItem?: Readonly<Record<string, readonly ProjectLabel[]>>;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly sortField: TaskSortField;
  readonly onSortChange: (field: TaskSortField) => void;
}

// Rows rendered before progressive disclosure; sorting always applies to
// the full item list first so order stays correct while expanding.
const LIST_ROW_PAGE_SIZE = 100;

const PRIORITY_WEIGHT: Record<WorkItemPriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * Normalizes optional due dates for lexicographic sorting.
 *
 * @param value - Due date or `null` for unscheduled items.
 * @returns The date, or an empty string sorting before any real date.
 */
function toSortableDueAt(value: string | null): string {
  if (value === null) {
    return "";
  }

  return value;
}

const SORT_COMPARISONS: Record<
  TaskSortField,
  (first: WorkItemDetail, second: WorkItemDetail) => number
> = {
  updated: (first, second) => first.updatedAt.localeCompare(second.updatedAt),
  priority: (first, second) =>
    PRIORITY_WEIGHT[first.priority] - PRIORITY_WEIGHT[second.priority],
  dueDate: (first, second) =>
    toSortableDueAt(first.dueAt).localeCompare(toSortableDueAt(second.dueAt)),
  project: (first, second) =>
    first.projectName.localeCompare(second.projectName),
  status: (first, second) => first.statusName.localeCompare(second.statusName),
  title: (first, second) => first.title.localeCompare(second.title),
};

/** Renders a compact, sortable table representation of work items. */
export function TasksList({
  workItems,
  selectedTaskId,
  labelsByWorkItem,
  onSelectTask,
  onOpenTask,
  sortField,
  onSortChange,
}: TasksListProps): React.ReactElement {
  const { t } = useTranslation();
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  function handleHeaderClick(field: TaskSortField): void {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      onSortChange(field);
      setSortDirection("asc");
    }
  }

  const sortedItems = [...workItems].sort((first, second) => {
    const comparison = SORT_COMPARISONS[sortField](first, second);

    return sortDirection === "asc" ? comparison : -comparison;
  });
  const [visibleRowCount, setVisibleRowCount] =
    useState<number>(LIST_ROW_PAGE_SIZE);
  const visibleItems = sortedItems.slice(0, visibleRowCount);
  const hiddenCount = sortedItems.length - visibleItems.length;

  function handleShowMore(): void {
    setVisibleRowCount((count) => count + LIST_ROW_PAGE_SIZE);
  }

  return (
    <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/40 font-semibold text-muted-foreground select-none">
          <tr>
            <th className="py-3 pr-2 pl-4">{t("tasks.columns.type")}</th>
            <th className="px-3 py-3">{t("tasks.columns.key")}</th>
            <th
              className="cursor-pointer px-3 py-3 transition-colors hover:text-foreground"
              onClick={() => handleHeaderClick("project")}
            >
              <span className="inline-flex items-center gap-1">
                {t("tasks.columns.project")}
                <ArrowUpDown className="size-3" aria-hidden="true" />
              </span>
            </th>
            <th
              className="cursor-pointer px-3 py-3 transition-colors hover:text-foreground"
              onClick={() => handleHeaderClick("title")}
            >
              <span className="inline-flex items-center gap-1">
                {t("tasks.columns.title")}
                <ArrowUpDown className="size-3" aria-hidden="true" />
              </span>
            </th>
            <th
              className="cursor-pointer px-3 py-3 transition-colors hover:text-foreground"
              onClick={() => handleHeaderClick("status")}
            >
              <span className="inline-flex items-center gap-1">
                {t("tasks.columns.status")}
                <ArrowUpDown className="size-3" aria-hidden="true" />
              </span>
            </th>
            <th
              className="cursor-pointer px-3 py-3 transition-colors hover:text-foreground"
              onClick={() => handleHeaderClick("priority")}
            >
              <span className="inline-flex items-center gap-1">
                {t("tasks.columns.priority")}
                <ArrowUpDown className="size-3" aria-hidden="true" />
              </span>
            </th>
            <th className="px-3 py-3">{t("tasks.columns.assignee")}</th>
            <th className="px-3 py-3">{t("tasks.columns.labels")}</th>
            <th
              className="cursor-pointer px-3 py-3 transition-colors hover:text-foreground"
              onClick={() => handleHeaderClick("dueDate")}
            >
              <span className="inline-flex items-center gap-1">
                {t("tasks.columns.dueAt")}
                <ArrowUpDown className="size-3" aria-hidden="true" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-muted/60">
          {visibleItems.map((item) => {
            const isSelected =
              item.id === selectedTaskId || item.key === selectedTaskId;

            return (
              <tr
                key={item.id}
                className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                  isSelected ? "bg-primary-subtle/70" : ""
                }`}
                onClick={() => onSelectTask(item.key)}
                onDoubleClick={() => onOpenTask(item.key)}
              >
                <td className="py-3 pr-2 pl-4">
                  <TaskTypeBadge type={item.type} />
                </td>
                <td className="px-3 py-3 font-semibold text-muted-foreground whitespace-nowrap">
                  {item.key}
                </td>
                <td className="px-3 py-3 font-medium text-foreground whitespace-nowrap">
                  {item.projectName}
                </td>
                <td className="max-w-md px-3 py-3">
                  <div className="font-medium text-foreground line-clamp-1">
                    {item.title}
                  </div>
                  {item.parentKey ? (
                    <span className="text-[11px] text-muted-foreground">
                      {item.parentKey} · {item.parentTitle}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <TaskStatusBadge
                    statusKey={item.statusKey}
                    statusName={item.statusName}
                  />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <TaskPriorityBadge priority={item.priority} />
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                  {item.assigneeName ?? t("tasks.unassigned")}
                </td>
                <td className="max-w-48 px-3 py-3">
                  <TaskLabelList
                    labels={labelsByWorkItem?.[item.id] ?? []}
                    maxVisible={2}
                  />
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                  {item.dueAt ?? "—"}
                </td>
              </tr>
            );
          })}
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
