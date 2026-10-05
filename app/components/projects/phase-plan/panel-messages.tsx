import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { PlanSaveError } from "@/app/lib/phase-plan/plan-types";

interface PanelMessagesProps {
  readonly hasRangeError: boolean;
  readonly isDirty: boolean;
  readonly saveError: PlanSaveError | null;
}

/** Renders validation and save errors, or the hint that nothing changed yet. */
export function PanelMessages({
  hasRangeError,
  isDirty,
  saveError,
}: PanelMessagesProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      {hasRangeError ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {t("projectDetail.planning.phasePlan.invalidRange")}
        </p>
      ) : null}
      {saveError ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {t(`projectDetail.planning.phasePlan.${saveError}`)}
        </p>
      ) : null}
      {isDirty || saveError ? null : (
        <div className="flex items-start gap-2.5 rounded-xl bg-muted/60 px-4 py-3">
          <Info
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="block font-semibold text-foreground">
              {t("projectDetail.planning.phasePlan.noChangesTitle")}
            </span>
            {t("projectDetail.planning.phasePlan.noChangesHint")}
          </p>
        </div>
      )}
    </>
  );
}
