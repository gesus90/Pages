import { Diamond } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Renders the hint shown while no milestone has a date. */
export function PlanEmptyState(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 flex flex-col items-center rounded-xl border border-border/60 bg-surface px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Diamond className="size-5" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">
        {t("projectDetail.planning.phasePlan.empty")}
      </p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {t("projectDetail.planning.phasePlan.emptyHint")}
      </p>
    </div>
  );
}
