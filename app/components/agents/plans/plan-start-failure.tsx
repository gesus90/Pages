import { useTranslation } from "react-i18next";

/** Keeps a failed background start visible even after another command was sent. */
export function PlanStartFailure({
  error,
}: {
  readonly error: string | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p role="alert" className="px-4 py-2 text-xs text-destructive">
      {t("plans.startFailed", {
        reason: t(`settings.agents.error.${error}`, {
          defaultValue: t("plans.panel.error"),
        }),
      })}
    </p>
  );
}
