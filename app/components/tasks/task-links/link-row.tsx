import { CheckCircle2, Circle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getLinkTypeLabelKey } from "@/app/components/tasks/task-links/link-type";

import type { WorkItemLink } from "@/definition/Task";

interface LinkRowProps {
  readonly link: WorkItemLink;
  readonly isArchived: boolean;
  readonly onSelectTask: (key: string) => void;
  readonly onRemove: (link: WorkItemLink) => void;
}

/** Renders one link with its type, the linked ticket and a remove button. */
export function LinkRow({
  link,
  isArchived,
  onSelectTask,
  onRemove,
}: LinkRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <li className="group flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs">
      <span className="shrink-0 rounded-md bg-surface px-2 py-1 font-medium text-muted-foreground">
        {t(getLinkTypeLabelKey(link))}
      </span>
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={() => onSelectTask(link.linkedWorkItemKey)}
        type="button"
      >
        {link.linkedWorkItemIsDone ? (
          <CheckCircle2
            className="size-3.5 shrink-0 text-emerald-500"
            aria-hidden="true"
          />
        ) : (
          <Circle
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="shrink-0 font-semibold text-muted-foreground">
          {link.linkedWorkItemKey}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {link.linkedWorkItemTitle}
        </span>
      </button>
      {!isArchived ? (
        <button
          aria-label={t("tasks.links.remove")}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
          onClick={() => onRemove(link)}
          type="button"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}
