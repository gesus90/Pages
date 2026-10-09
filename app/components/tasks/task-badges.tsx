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

const TYPE_ICON_STYLES = {
  [WORK_ITEM_TYPE.INITIATIVE]: { className: "text-[#6d28d9]", icon: Layers },
  [WORK_ITEM_TYPE.EPIC]: {
    className: "fill-current text-[#7e22ce]",
    icon: Bookmark,
  },
  [WORK_ITEM_TYPE.TASK]: {
    className: "fill-current text-[#1d4ed8]",
    icon: Circle,
  },
  [WORK_ITEM_TYPE.SUBTASK]: { className: "text-[#047857]", icon: CheckCircle2 },
} as const satisfies Readonly<
  Record<WorkItemType, { readonly className: string; readonly icon: unknown }>
>;

/**
 * Renders the small symbol of a ticket type in its color, for narrow places
 * such as the ticket tree; the type name is given there as text.
 */
export function TaskTypeIcon({
  type,
}: {
  readonly type: WorkItemType;
}): React.ReactElement {
  const { className, icon: Icon } = TYPE_ICON_STYLES[type];

  return (
    <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${className}`} />
  );
}

/**
 * The color of the dot of a workflow status.
 *
 * @param statusKey - Key of the status.
 * @returns The background class of the dot; unknown statuses look like backlog.
 */
export function statusDotClass(statusKey: string): string {
  if (statusKey === WORKFLOW_STATUS_KEY.TODO) {
    return "bg-blue-500";
  }

  if (statusKey === WORKFLOW_STATUS_KEY.IN_PROGRESS) {
    return "bg-[#f97316]";
  }

  if (statusKey === WORKFLOW_STATUS_KEY.REVIEW) {
    return "bg-purple-500";
  }

  return statusKey === WORKFLOW_STATUS_KEY.DONE
    ? "bg-emerald-500"
    : "bg-slate-400";
}

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
  const dotColor = statusDotClass(statusKey);

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-foreground ${className}`}
    >
      <span className={`size-2 rounded-full ${dotColor}`} aria-hidden="true" />
      {statusName}
    </span>
  );
}
