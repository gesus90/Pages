import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { LabelEditor } from "@/app/components/tasks/label-editor";
import { Button } from "@/app/components/ui/button";

import type { LabelCreation } from "@/app/components/tasks/label-picker/use-label-creation";

interface LabelCreateSectionProps {
  readonly creation: LabelCreation;
  readonly isSubmitting: boolean;
}

/** Renders the button that opens the new-label form, or the form itself. */
export function LabelCreateSection({
  creation,
  isSubmitting,
}: LabelCreateSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 border-t border-border pt-4">
      {creation.isCreating ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-foreground">
            {t("tasks.labels.createTitle")}
          </p>
          <LabelEditor
            name={creation.newName}
            color={creation.newColor}
            isSaving={isSubmitting}
            canSave={creation.newName.trim().length > 0}
            saveLabel={t("tasks.labels.create")}
            onNameChange={creation.setNewName}
            onColorChange={creation.setNewColor}
            onSave={creation.createLabel}
            onCancel={creation.closeForm}
          />
        </div>
      ) : (
        <Button
          className="w-full gap-1.5"
          onClick={creation.startCreating}
          type="button"
          variant="outline"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("tasks.labels.createTitle")}
        </Button>
      )}
    </div>
  );
}
