import { CheckCircle2, ChevronDown, ChevronRight, Circle } from "lucide-react";

import type { WorkItemDetail } from "@/definition/Task";

interface HierarchyRowToggleProps {
  readonly item: WorkItemDetail;
  readonly hasChildren: boolean;
  readonly isExpanded: boolean;
  readonly onToggle: (id: string) => void;
}

/** Renders the expand button of a parent row, or the done marker of a leaf. */
export function HierarchyRowToggle({
  item,
  hasChildren,
  isExpanded,
  onToggle,
}: HierarchyRowToggleProps): React.ReactElement {
  if (!hasChildren) {
    return (
      <span
        className="inline-flex size-6 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {item.isDone ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <Circle className="size-4 text-muted-foreground/50" />
        )}
      </span>
    );
  }

  return (
    <button
      aria-expanded={isExpanded}
      aria-label={`${item.key} ${item.title}`}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={() => onToggle(item.id)}
      type="button"
    >
      {isExpanded ? (
        <ChevronDown className="size-4" aria-hidden="true" />
      ) : (
        <ChevronRight className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
