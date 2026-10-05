import { AlertCircle, ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { WORK_ITEM_PRIORITY } from "@/definition/Task";

import type { ReactNode } from "react";
import type { WorkItemPriority } from "@/definition/Task";

interface KanbanGhostPriorityProps {
  readonly priority: WorkItemPriority;
}

/** Renders the priority label of the drop ghost. */
export function KanbanGhostPriority({
  priority,
}: KanbanGhostPriorityProps): React.ReactElement {
  const { t } = useTranslation();

  let priorityIcon: ReactNode = (
    <span className="size-1.5 rounded-full bg-primary/60" aria-hidden="true" />
  );
  let priorityLabel = t("tasks.priority.normal");

  if (priority === WORK_ITEM_PRIORITY.URGENT) {
    priorityIcon = <AlertCircle className="size-3.5" aria-hidden="true" />;
    priorityLabel = t("tasks.priority.urgent");
  } else if (priority === WORK_ITEM_PRIORITY.HIGH) {
    priorityIcon = <ArrowUp className="size-3.5" aria-hidden="true" />;
    priorityLabel = t("tasks.priority.high");
  } else if (priority === WORK_ITEM_PRIORITY.LOW) {
    priorityIcon = <ArrowDown className="size-3.5" aria-hidden="true" />;
    priorityLabel = t("tasks.priority.low");
  }

  return (
    <span className="inline-flex items-center gap-1 font-medium text-primary">
      {priorityIcon}
      {priorityLabel}
    </span>
  );
}
