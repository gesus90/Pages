import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { Label } from "@/definition/Task";

interface LabelDeleteControlProps {
  readonly label: Label;
  readonly usage: number;
  readonly isConfirming: boolean;
  readonly isSubmitting: boolean;
  readonly onDelete: (label: Label) => void;
  readonly onCancel: () => void;
}

/** Renders the delete button, or the confirmation with the usage count. */
export function LabelDeleteControl({
  label,
  usage,
  isConfirming,
  isSubmitting,
  onDelete,
  onCancel,
}: LabelDeleteControlProps): React.ReactElement {
  const { t } = useTranslation();

  if (!isConfirming) {
    return (
      <div className="flex justify-start">
        <Button
          className="h-8 gap-1.5 px-3 text-xs text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(label)}
          type="button"
          variant="ghost"
        >
          {t("tasks.labels.delete")}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
      <p className="font-medium text-foreground">
        {t("tasks.labels.deleteConfirm", {
          count: usage,
          name: label.name,
        })}
      </p>
      <div className="mt-2 flex justify-end gap-2">
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
          disabled={isSubmitting}
          onClick={() => onDelete(label)}
          type="button"
        >
          {t("tasks.labels.deleteSubmit")}
        </Button>
      </div>
    </div>
  );
}
