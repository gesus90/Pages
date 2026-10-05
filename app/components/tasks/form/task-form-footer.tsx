import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { DialogClose } from "@/app/components/ui/dialog";

interface TaskFormFooterProps {
  readonly mode: "create" | "edit";
  readonly isSubmitting: boolean;
  readonly error: string | null;
}

/** The error message and the cancel and submit buttons of the work item form. */
export function TaskFormFooter({
  mode,
  isSubmitting,
  error,
}: TaskFormFooterProps): React.ReactElement {
  const { t } = useTranslation();
  const submitLabels = {
    create: {
      idle: t("tasks.create.submit"),
      busy: t("tasks.create.submitting"),
    },
    edit: { idle: t("tasks.edit.submit"), busy: t("tasks.edit.submitting") },
  }[mode];

  return (
    <>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`tasks.error.${error}`, { defaultValue: error })}
        </p>
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">{t("tasks.actions.cancel")}</Button>
        </DialogClose>
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? submitLabels.busy : submitLabels.idle}
        </Button>
      </div>
    </>
  );
}
