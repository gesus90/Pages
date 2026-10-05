import { useTranslation } from "react-i18next";

import { DetailSection } from "@/app/components/tasks/detail-section";
import { TaskChecklist } from "@/app/components/tasks/task-checklist";

import type { WorkItemChecklistItem } from "@/definition/Task";

interface DetailChecklistSectionProps {
  readonly workItemId: string;
  readonly items: readonly WorkItemChecklistItem[];
  readonly isArchived: boolean;
  readonly isSubmitting: boolean;
}

/** Renders the checklist of a ticket with its done counter. */
export function DetailChecklistSection({
  workItemId,
  items,
  isArchived,
  isSubmitting,
}: DetailChecklistSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DetailSection
      title={t("tasks.checklist.title")}
      trailing={
        items.length > 0 ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
            {items.filter((item) => item.isDone).length} / {items.length}
          </span>
        ) : undefined
      }
    >
      <TaskChecklist
        isArchived={isArchived}
        isSubmitting={isSubmitting}
        items={items}
        workItemId={workItemId}
      />
    </DetailSection>
  );
}
