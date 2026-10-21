import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { LabelListItem } from "@/app/components/tasks/label-picker/label-list-item";

import type { LabelEditing } from "@/app/components/tasks/label-picker/use-label-editing";
import type { Label } from "@/definition/Task";

interface LabelListProps {
  readonly labels: readonly Label[];
  readonly assignedLabelIds: ReadonlySet<string>;
  readonly labelUsage: Readonly<Record<string, number>>;
  readonly isSubmitting: boolean;
  readonly editing: LabelEditing;
  readonly onToggle: (label: Label) => void;
}

/** Renders the scrollable list of catalog labels. */
export function LabelList({
  labels,
  assignedLabelIds,
  labelUsage,
  isSubmitting,
  editing,
  onToggle,
}: LabelListProps): React.ReactElement {
  return (
    <ScrollViewport
      as="ul"
      axis="vertical"
      containerClassName="mt-3 max-h-64"
      className="flex flex-col gap-1 overflow-y-auto"
    >
      {labels.map((label) => (
        <LabelListItem
          key={label.id}
          editing={editing}
          isAssigned={assignedLabelIds.has(label.id)}
          isSubmitting={isSubmitting}
          label={label}
          onToggle={onToggle}
          usage={labelUsage[label.id] ?? 0}
        />
      ))}
    </ScrollViewport>
  );
}
