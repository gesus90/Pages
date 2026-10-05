import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

interface LabelEditorActionsProps {
  readonly isSaveDisabled: boolean;
  readonly saveLabel: string;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/** Renders the cancel and save buttons below the label form. */
export function LabelEditorActions({
  isSaveDisabled,
  saveLabel,
  onSave,
  onCancel,
}: LabelEditorActionsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex justify-end gap-2">
      <Button
        className="h-8 px-3 text-xs"
        onClick={onCancel}
        type="button"
        variant="ghost"
      >
        {t("tasks.actions.cancel")}
      </Button>
      <Button
        className="h-8 px-3 text-xs"
        disabled={isSaveDisabled}
        onClick={onSave}
        type="button"
      >
        {saveLabel}
      </Button>
    </div>
  );
}
