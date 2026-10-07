import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DetailSection } from "@/app/components/tasks/detail-section";
import { TaskLabelPill } from "@/app/components/tasks/task-labels";
import { Select } from "@/app/components/ui/select";
import { WORK_ITEM_PRIORITY } from "@/definition/Task";

import type {
  Label,
  WorkItemDetail,
  WorkItemPriority,
} from "@/definition/Task";

interface DetailKeyDetailsSectionProps {
  readonly task: WorkItemDetail;
  readonly taskLabels: readonly Label[];
  readonly isArchived: boolean;
  readonly onChangePriority: (priority: WorkItemPriority) => void;
  readonly onRemoveLabel: (label: Label) => void;
  readonly onEditLabels: () => void;
}

/** Renders the priority and the labels of a ticket. */
export function DetailKeyDetailsSection({
  task,
  taskLabels,
  isArchived,
  onChangePriority,
  onRemoveLabel,
  onEditLabels,
}: DetailKeyDetailsSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DetailSection title={t("tasks.detail.keyDetails")}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">{t("tasks.fields.priority")}</dt>
        <dt className="text-muted-foreground">{t("tasks.fields.labels")}</dt>
        <dd className="min-w-0">
          <Select
            ariaLabel={t("tasks.fields.priority")}
            className="w-full min-w-0"
            disabled={isArchived}
            onValueChange={onChangePriority}
            options={[
              {
                label: t("tasks.priority.low"),
                value: WORK_ITEM_PRIORITY.LOW,
              },
              {
                label: t("tasks.priority.normal"),
                value: WORK_ITEM_PRIORITY.NORMAL,
              },
              {
                label: t("tasks.priority.high"),
                value: WORK_ITEM_PRIORITY.HIGH,
              },
              {
                label: t("tasks.priority.urgent"),
                value: WORK_ITEM_PRIORITY.URGENT,
              },
            ]}
            value={task.priority}
          />
        </dd>
        <dd className="flex min-w-0 flex-wrap items-center gap-1">
          {taskLabels.map((label) => (
            <TaskLabelPill
              key={label.id}
              label={label}
              onRemove={isArchived ? undefined : () => onRemoveLabel(label)}
            />
          ))}
          <button
            aria-label={t("tasks.labels.editLabels")}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            disabled={isArchived}
            onClick={onEditLabels}
            type="button"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        </dd>
      </dl>
    </DetailSection>
  );
}
