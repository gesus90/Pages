import { X } from "lucide-react";

import type { ProjectLabel } from "@/definition/Task";

interface TaskLabelPillProps {
  readonly label: ProjectLabel;
  readonly onRemove?: () => void;
}

/** Renders one project label with its catalog color. */
export function TaskLabelPill({
  label,
  onRemove,
}: TaskLabelPillProps): React.ReactElement {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${label.color}1f`, color: label.color }}
    >
      {label.name}
      {onRemove ? (
        <button
          aria-label={`${label.name} ×`}
          className="inline-flex items-center opacity-70 hover:opacity-100"
          onClick={onRemove}
          type="button"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

interface TaskLabelListProps {
  readonly labels: readonly ProjectLabel[];
  readonly maxVisible?: number;
}

/** Renders the label pills of a ticket, collapsing overflow into a counter. */
export function TaskLabelList({
  labels,
  maxVisible = 4,
}: TaskLabelListProps): React.ReactElement | null {
  if (labels.length === 0) {
    return null;
  }

  const visible = labels.slice(0, maxVisible);
  const overflow = labels.length - visible.length;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {visible.map((label) => (
        <TaskLabelPill key={label.id} label={label} />
      ))}
      {overflow > 0 ? (
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
