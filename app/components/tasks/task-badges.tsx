import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bookmark,
  CheckCircle2,
  Circle,
  Layers,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";

import type { WorkItemPriority, WorkItemType } from "@/definition/Task";

interface TaskTypeBadgeProps {
  readonly type: WorkItemType;
  readonly className?: string;
}

/** Renders a distinct visual badge for an Initiative, Epic, Task, or Subtask. */
export function TaskTypeBadge({
  type,
  className = "",
}: TaskTypeBadgeProps): React.ReactElement {
  const { t } = useTranslation();

  if (type === WORK_ITEM_TYPE.INITIATIVE) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md bg-[#ede9fe] px-2 py-0.5 text-xs font-medium text-[#6d28d9] ${className}`}
      >
        <Layers className="size-3.5" aria-hidden="true" />
        {t("tasks.type.initiative")}
      </span>
    );
  }

  if (type === WORK_ITEM_TYPE.EPIC) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md bg-[#f3e8ff] px-2 py-0.5 text-xs font-medium text-[#7e22ce] ${className}`}
      >
        <Bookmark className="size-3.5 fill-current" aria-hidden="true" />
        {t("tasks.type.epic")}
      </span>
    );
  }

  if (type === WORK_ITEM_TYPE.SUBTASK) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md bg-[#ecfdf5] px-2 py-0.5 text-xs font-medium text-[#047857] ${className}`}
      >
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        {t("tasks.type.subtask")}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md bg-[#eff6ff] px-2 py-0.5 text-xs font-medium text-[#1d4ed8] ${className}`}
    >
      <Circle className="size-3 fill-current" aria-hidden="true" />
      {t("tasks.type.task")}
    </span>
  );
}

interface TaskPriorityBadgeProps {
  readonly priority: WorkItemPriority;
  readonly className?: string;
}

/** Renders a priority indicator with semantic color cues. */
export function TaskPriorityBadge({
  priority,
  className = "",
}: TaskPriorityBadgeProps): React.ReactElement {
  const { t } = useTranslation();

  if (priority === WORK_ITEM_PRIORITY.URGENT) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium text-rose-600 ${className}`}
      >
        <AlertCircle className="size-3.5" aria-hidden="true" />
        {t("tasks.priority.urgent")}
      </span>
    );
  }

  if (priority === WORK_ITEM_PRIORITY.HIGH) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium text-[#ea580c] ${className}`}
      >
        <ArrowUp className="size-3.5" aria-hidden="true" />
        {t("tasks.priority.high")}
      </span>
    );
  }

  if (priority === WORK_ITEM_PRIORITY.LOW) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium text-[#059669] ${className}`}
      >
        <ArrowDown className="size-3.5" aria-hidden="true" />
        {t("tasks.priority.low")}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium text-muted-foreground ${className}`}
    >
      <span
        className="size-1.5 rounded-full bg-muted-foreground/60"
        aria-hidden="true"
      />
      {t("tasks.priority.normal")}
    </span>
  );
}

interface TaskStatusBadgeProps {
  readonly statusKey: string;
  readonly statusName: string;
  readonly className?: string;
}

/** Renders a workflow phase badge. */
export function TaskStatusBadge({
  statusKey,
  statusName,
  className = "",
}: TaskStatusBadgeProps): React.ReactElement {
  let dotColor = "bg-slate-400";

  if (statusKey === WORKFLOW_STATUS_KEY.TODO) {
    dotColor = "bg-blue-500";
  } else if (statusKey === WORKFLOW_STATUS_KEY.IN_PROGRESS) {
    dotColor = "bg-[#f97316]";
  } else if (statusKey === WORKFLOW_STATUS_KEY.REVIEW) {
    dotColor = "bg-purple-500";
  } else if (statusKey === WORKFLOW_STATUS_KEY.DONE) {
    dotColor = "bg-emerald-500";
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-foreground ${className}`}
    >
      <span className={`size-2 rounded-full ${dotColor}`} aria-hidden="true" />
      {statusName}
    </span>
  );
}
