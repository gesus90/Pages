import { ArrowLeft, Edit3 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TaskTypeBadge } from "@/app/components/tasks/task-badges";
import { Button } from "@/app/components/ui/button";

import type { WorkItemDetail } from "@/definition/Task";

interface TicketHeadingProps {
  readonly ticket: WorkItemDetail;
  readonly isArchived: boolean;
  readonly onBack: () => void;
  readonly onEdit: () => void;
}

/** Renders type, key, title and the back and edit buttons of a ticket. */
export function TicketHeading({
  ticket,
  isArchived,
  onBack,
  onEdit,
}: TicketHeadingProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <TaskTypeBadge type={ticket.type} />
          <span className="text-xs font-semibold text-muted-foreground">
            {ticket.key}
          </span>
          {isArchived ? (
            <span className="rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
              {t("tasks.archived.badge")}
            </span>
          ) : null}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {ticket.title}
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <Button
          className="gap-1.5"
          onClick={onBack}
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("tasks.detail.back")}
        </Button>
        <Button
          className="gap-1.5"
          disabled={isArchived}
          onClick={onEdit}
          type="button"
        >
          <Edit3 className="size-4" aria-hidden="true" />
          {t("tasks.actions.edit")}
        </Button>
      </div>
    </div>
  );
}
