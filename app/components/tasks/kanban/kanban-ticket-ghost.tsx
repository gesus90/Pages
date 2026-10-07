import { CheckSquare } from "lucide-react";

import { AssigneeAvatar } from "@/app/components/tasks/assignee-avatar";

import { KanbanGhostPriority } from "./kanban-ghost-priority";
import { KanbanGhostType } from "./kanban-ghost-type";

import type { Label, WorkItemDetail } from "@/definition/Task";

interface KanbanTicketGhostProps {
  readonly item: WorkItemDetail;
  readonly labels: readonly Label[];
}

/**
 * Renders the orange insertion preview shown while dragging a ticket.
 *
 * @remarks
 * Mirrors the dimensions and layout of a real ticket so it occupies exactly
 * the space the dropped ticket will take, without shifting the column.
 */
export function KanbanTicketGhost({
  item,
  labels,
}: KanbanTicketGhostProps): React.ReactElement {
  return (
    <article
      className="pointer-events-none relative rounded-2xl bg-primary/10 p-4 opacity-60"
      aria-hidden="true"
      data-drop-ghost
    >
      <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-primary/40" />
      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <KanbanGhostType type={item.type} />
          <span className="flex items-center gap-1.5">
            {item.githubIssueNumber !== null ? (
              <span
                className="size-2 rounded-full bg-primary/60"
                aria-hidden="true"
              />
            ) : null}
            <span className="text-[11px] font-semibold tracking-wide text-primary/70">
              {item.key}
            </span>
          </span>
        </div>

        <h4 className="mt-2.5 line-clamp-2 text-sm font-semibold text-primary">
          {item.title}
        </h4>

        <p className="mt-1 text-[11px] font-medium text-primary/60">
          {item.projectName}
        </p>

        {labels.length > 0 ? (
          <div className="mt-2.5">
            <span className="inline-flex flex-wrap items-center gap-1">
              {labels.slice(0, 3).map((label) => (
                <span
                  key={label.id}
                  className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary/80"
                >
                  {label.name}
                </span>
              ))}
              {labels.length > 3 ? (
                <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary/80">
                  +{labels.length - 3}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}

        <div className="mt-3.5 flex items-center justify-between gap-2 text-xs">
          <KanbanGhostPriority priority={item.priority} />

          <div className="flex items-center gap-2">
            {item.subtaskTotal > 0 ? (
              <span className="inline-flex items-center gap-1 font-medium text-primary/70">
                <CheckSquare className="size-3.5" aria-hidden="true" />
                {item.subtaskCompleted} / {item.subtaskTotal}
              </span>
            ) : null}

            <AssigneeAvatar
              item={item}
              className="bg-primary/15 text-primary"
            />
          </div>
        </div>
      </div>
    </article>
  );
}
