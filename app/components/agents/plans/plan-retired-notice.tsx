import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

/** Explains the replacement when an old agent-list bookmark opens the plan editor. */
export function PlanRetiredNotice(): React.ReactElement | null {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  if (searchParams.get("notice") !== "direct-models") return null;
  return (
    <p
      role="status"
      className="fixed top-20 left-4 md:left-[calc(var(--app-sidebar-width)+1rem)] z-40 max-w-sm rounded-xl border border-border bg-surface p-3 text-sm text-foreground shadow-panel"
    >
      {t("picaSettings.retired")}
    </p>
  );
}
