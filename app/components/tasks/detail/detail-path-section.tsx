import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TaskTypeBadge } from "@/app/components/tasks/task-badges";
import { DetailSection } from "@/app/components/tasks/detail-section";
import { TicketParentField } from "@/app/components/tasks/hierarchy/ticket-parent-field";
import { cn } from "@/app/lib/cn";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { WorkItemDetail } from "@/definition/Task";

const MAXIMUM_PATH_DEPTH = 10;

const PATH_DOT_CLASSES: Readonly<Record<WorkItemDetail["type"], string>> = {
  [WORK_ITEM_TYPE.INITIATIVE]: "border-violet-500",
  [WORK_ITEM_TYPE.EPIC]: "border-blue-500",
  [WORK_ITEM_TYPE.TASK]: "border-emerald-500",
  [WORK_ITEM_TYPE.SUBTASK]: "border-emerald-500",
};

/**
 * Resolves the ancestor chain of a ticket, top-down.
 *
 * @param task - The ticket whose ancestors are wanted.
 * @param workItems - Every ticket the chain may run through.
 * @returns Ancestors from the root down to the direct parent.
 */
export function getAncestorChain(
  task: WorkItemDetail,
  workItems: readonly WorkItemDetail[],
): WorkItemDetail[] {
  const byId = new Map(workItems.map((item) => [item.id, item]));
  const chain: WorkItemDetail[] = [];
  const visited = new Set<string>([task.id]);
  let parentId = task.parentId;

  while (parentId && chain.length < MAXIMUM_PATH_DEPTH) {
    const parent = byId.get(parentId);

    if (visited.has(parentId) || !parent) {
      break;
    }

    visited.add(parentId);
    chain.unshift(parent);
    parentId = parent.parentId;
  }

  return chain;
}

interface PathChainProps {
  readonly task: WorkItemDetail;
  readonly chain: readonly WorkItemDetail[];
  readonly onSelectTask: (key: string) => void;
}

/** Renders the ancestors of a ticket and the ticket itself as a vertical path. */
function PathChain({
  task,
  chain,
  onSelectTask,
}: PathChainProps): React.ReactElement {
  return (
    <ol className="flex flex-col">
      {[...chain, task].map((entry, index, all) => {
        const isCurrent = entry.id === task.id;
        const hasConnector = index < all.length - 1;

        return (
          <li
            key={entry.id}
            className="relative flex items-center gap-2.5 pb-3 last:pb-0"
          >
            {hasConnector ? (
              <span
                aria-hidden="true"
                className="absolute top-6 bottom-0 left-[5px] w-px bg-border"
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0 rounded-full border-2 bg-surface",
                PATH_DOT_CLASSES[entry.type],
              )}
            />
            {isCurrent ? (
              <span
                aria-current="true"
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1.5"
              >
                <TaskTypeBadge type={entry.type} />
                <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                  {entry.key}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {entry.title}
                </span>
              </span>
            ) : (
              <button
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                onClick={() => onSelectTask(entry.key)}
                type="button"
              >
                <TaskTypeBadge type={entry.type} />
                <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                  {entry.key}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {entry.title}
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface DetailPathSectionProps {
  readonly task: WorkItemDetail;
  readonly workItems: readonly WorkItemDetail[];
  readonly isArchived: boolean;
  readonly onSelectTask: (key: string) => void;
}

/** Renders the ancestor chain of a ticket and the select for its parent. */
export function DetailPathSection({
  task,
  workItems,
  isArchived,
  onSelectTask,
}: DetailPathSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DetailSection
      icon={
        <MapPin
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      }
      title={t("tasks.path.title")}
    >
      <div className="flex flex-col gap-3">
        <PathChain
          chain={getAncestorChain(task, workItems)}
          onSelectTask={onSelectTask}
          task={task}
        />
        <TicketParentField
          isDisabled={isArchived}
          onOpenTicket={onSelectTask}
          ticket={task}
          workItems={workItems}
        />
      </div>
    </DetailSection>
  );
}
