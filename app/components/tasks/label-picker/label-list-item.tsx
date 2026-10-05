import { LabelEditRow } from "@/app/components/tasks/label-picker/label-edit-row";
import { LabelRow } from "@/app/components/tasks/label-picker/label-row";
import { cn } from "@/app/lib/cn";

import type { LabelEditing } from "@/app/components/tasks/label-picker/use-label-editing";
import type { ProjectLabel } from "@/definition/Task";

interface LabelListItemProps {
  readonly label: ProjectLabel;
  readonly isAssigned: boolean;
  readonly usage: number;
  readonly isSubmitting: boolean;
  readonly editing: LabelEditing;
  readonly onToggle: (label: ProjectLabel) => void;
}

/** Renders one catalog label as a row, or as its edit form while editing. */
export function LabelListItem({
  label,
  isAssigned,
  usage,
  isSubmitting,
  editing,
  onToggle,
}: LabelListItemProps): React.ReactElement {
  return (
    <li
      className={cn(
        "group rounded-xl p-1.5 text-sm transition-colors",
        isAssigned
          ? "bg-primary/10 ring-1 ring-primary/40"
          : "bg-muted/40 hover:bg-muted/70",
      )}
    >
      {editing.editingId === label.id ? (
        <LabelEditRow
          editing={editing}
          isSubmitting={isSubmitting}
          label={label}
          usage={usage}
        />
      ) : (
        <LabelRow
          isAssigned={isAssigned}
          label={label}
          onEdit={editing.startEdit}
          onToggle={onToggle}
          usage={usage}
        />
      )}
    </li>
  );
}
