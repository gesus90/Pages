import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { filterLabels } from "@/app/components/tasks/label-picker/filter-labels";
import { LabelCreateSection } from "@/app/components/tasks/label-picker/label-create-section";
import { LabelList } from "@/app/components/tasks/label-picker/label-list";
import { LabelSearchField } from "@/app/components/tasks/label-picker/label-search-field";
import { useLabelCreation } from "@/app/components/tasks/label-picker/use-label-creation";
import { useLabelEditing } from "@/app/components/tasks/label-picker/use-label-editing";
import { useLabelFailure } from "@/app/components/tasks/label-picker/use-label-failure";
import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";

import type { Label } from "@/definition/Task";

interface LabelPickerProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workItemId: string;
  readonly labels: readonly Label[];
  readonly assignedLabelIds: ReadonlySet<string>;
  readonly labelUsage: Readonly<Record<string, number>>;
  readonly isSubmitting?: boolean;
}

/** Picks labels for a ticket and manages the global label catalog. */
export function LabelPicker({
  isOpen,
  onOpenChange,
  workItemId,
  labels,
  assignedLabelIds,
  labelUsage,
  isSubmitting = false,
}: LabelPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [query, setQuery] = useState("");
  const creation = useLabelCreation({
    assignedLabelIds,
    labels,
    workItemId,
  });
  const editing = useLabelEditing();
  const failure = useLabelFailure();

  const visibleLabels = filterLabels(labels, query);

  function handleOpenChange(open: boolean): void {
    creation.cancelPendingAssign();
    failure.dismiss();
    onOpenChange(open);
  }

  function handleToggle(label: Label): void {
    void submit(
      {
        intent: assignedLabelIds.has(label.id)
          ? "label-unassign"
          : "label-assign",
        labelId: label.id,
        workItemId,
      },
      { method: "post" },
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(28rem,94vw)] overflow-y-auto">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("tasks.labels.pickerTitle")}
        </DialogTitle>

        {failure.error ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {t(`tasks.error.${failure.error}`)}
          </p>
        ) : null}

        <LabelSearchField query={query} onQueryChange={setQuery} />

        <LabelList
          assignedLabelIds={assignedLabelIds}
          editing={editing}
          isSubmitting={isSubmitting}
          labelUsage={labelUsage}
          labels={visibleLabels}
          onToggle={handleToggle}
        />

        {visibleLabels.length === 0 ? (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {t("tasks.labels.noMatches")}
          </p>
        ) : null}

        <LabelCreateSection creation={creation} isSubmitting={isSubmitting} />
      </DialogContent>
    </Dialog>
  );
}
