import { Check, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Label } from "@/definition/Task";

interface LabelRowProps {
  readonly label: Label;
  readonly isAssigned: boolean;
  readonly usage: number;
  readonly onToggle: (label: Label) => void;
  readonly onEdit: (label: Label) => void;
}

/** Renders a label that can be toggled on the ticket or opened for editing. */
export function LabelRow({
  label,
  isAssigned,
  usage,
  onToggle,
  onEdit,
}: LabelRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1">
      <button
        aria-pressed={isAssigned}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
        onClick={() => onToggle(label)}
        type="button"
      >
        <span
          className="size-3.5 shrink-0 rounded-full ring-1 ring-black/10"
          style={{ backgroundColor: label.color }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {label.name}
        </span>
        {isAssigned ? (
          <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
        ) : null}
      </button>
      <span
        className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums"
        title={t("tasks.labels.usage", { count: usage })}
      >
        {usage}
      </span>
      <button
        aria-label={`${t("tasks.labels.edit")} ${label.name}`}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-surface hover:text-foreground focus-visible:opacity-100"
        onClick={() => onEdit(label)}
        type="button"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
