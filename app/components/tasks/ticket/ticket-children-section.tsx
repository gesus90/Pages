import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import {
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { Button } from "@/app/components/ui/button";
import { WORK_ITEM_CHILD_TYPE } from "@/definition/Task";

import type { WorkItemDetail, WorkItemType } from "@/definition/Task";

const TITLE_KEYS: Readonly<Record<WorkItemType, string>> = {
  epic: "tasks.detail.containedTasks",
  initiative: "tasks.detail.containedEpics",
  subtask: "tasks.tabs.subtasks",
  task: "tasks.tabs.subtasks",
};

interface TicketChildrenSectionProps {
  readonly ticket: WorkItemDetail;
  readonly items: readonly WorkItemDetail[];
  readonly canAdd: boolean;
  readonly onCreateChild: () => void;
  /** Builds the address of a child, keeping the view the person came from. */
  readonly hrefOf: (key: string) => string;
}

/**
 * The children of a ticket with their type, key, title and status, and the
 * button that adds one of the level below (A8.2-E03). Subtasks have none.
 */
export function TicketChildrenSection({
  ticket,
  items,
  canAdd,
  onCreateChild,
  hrefOf,
}: TicketChildrenSectionProps): React.ReactElement | null {
  const { t } = useTranslation();

  if (WORK_ITEM_CHILD_TYPE[ticket.type] === null) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t(TITLE_KEYS[ticket.type])}
          <span className="ml-2 text-xs font-medium text-muted-foreground">
            {ticket.subtaskCompleted} / {ticket.subtaskTotal}{" "}
            {t("tasks.detail.doneSuffix")}
          </span>
        </h2>
        {canAdd ? (
          <Button
            className="h-8 gap-1.5 px-3 text-xs"
            type="button"
            variant="outline"
            onClick={onCreateChild}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {t(`tasks.children.add.${ticket.type}`)}
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("tasks.children.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((child) => (
            <li key={child.id}>
              <Link
                className="flex w-full items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-left text-sm hover:bg-muted"
                prefetch="intent"
                to={hrefOf(child.key)}
              >
                <TaskTypeBadge type={child.type} />
                <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                  {child.key}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {child.title}
                </span>
                <TaskStatusBadge
                  statusKey={child.statusKey}
                  statusName={child.statusName}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
