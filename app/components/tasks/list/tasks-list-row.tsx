import { useTranslation } from "react-i18next";

import {
  TaskPriorityBadge,
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { TaskLabelList } from "@/app/components/tasks/task-labels";

import type { Label, WorkItemDetail } from "@/definition/Task";

interface TasksListRowProps {
  readonly item: WorkItemDetail;
  readonly labels: readonly Label[];
  readonly isSelected: boolean;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

/** Renders one work item as a row of the task list. */
export function TasksListRow({
  item,
  labels,
  isSelected,
  onSelectTask,
  onOpenTask,
}: TasksListRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <tr
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
        {item.assigneeName ?? item.assigneeGroupName ?? t("tasks.unassigned")}
      </td>
      <td className="max-w-48 px-3 py-3">
        <TaskLabelList labels={labels} maxVisible={2} />
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
        {item.dueAt ?? "—"}
      </td>
    </tr>
  );
}
