import { Check, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { WorkItemChecklistItem } from "@/definition/Task";

interface ChecklistItemRowProps {
  readonly item: WorkItemChecklistItem;
  readonly isArchived: boolean;
  readonly onToggle: (item: WorkItemChecklistItem) => void;
  readonly onDelete: (item: WorkItemChecklistItem) => void;
}

/** Renders one checklist item with its done toggle and remove button. */
export function ChecklistItemRow({
  item,
  isArchived,
  onToggle,
  onDelete,
}: ChecklistItemRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <li className="group flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
      <button
        aria-pressed={item.isDone}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md border border-muted-foreground/40 text-transparent transition-colors disabled:opacity-60",
          item.isDone && "border-primary bg-primary text-primary-foreground",
        )}
        disabled={isArchived}
        onClick={() => onToggle(item)}
        type="button"
      >
        <Check className="size-3.5" aria-hidden="true" />
      </button>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          item.isDone
            ? "text-muted-foreground line-through"
            : "text-foreground",
        )}
      >
        {item.title}
      </span>
      {!isArchived ? (
        <button
          aria-label={t("tasks.checklist.remove")}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
          onClick={() => onDelete(item)}
          type="button"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}
