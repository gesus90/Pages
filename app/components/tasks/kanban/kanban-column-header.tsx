import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { WorkflowStatus } from "@/definition/Task";

interface KanbanColumnHeaderProps {
  readonly status: WorkflowStatus;
  readonly itemCount: number;
  readonly onQuickCreate: (statusId: string) => void;
}

/** Renders the title, ticket count and quick-create button of a column. */
export function KanbanColumnHeader({
  status,
  itemCount,
  onQuickCreate,
}: KanbanColumnHeaderProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <header className="flex items-center justify-between gap-2 px-1 pb-4">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {status.name}
        </h3>
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-surface/70 text-[11px] font-semibold text-muted-foreground select-none">
          {itemCount}
        </span>
      </div>
      <button
        aria-label={`${t("tasks.create.trigger")} (${status.name})`}
        className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors select-none hover:bg-surface/70 hover:text-foreground"
        onClick={() => onQuickCreate(status.id)}
        type="button"
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </header>
  );
}
