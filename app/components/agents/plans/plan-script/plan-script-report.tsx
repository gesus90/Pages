import { useTranslation } from "react-i18next";

import type { AgentPlanScriptAssessment } from "@/definition/AgentPlanScriptReport";

/** Shows the validated report outcome separately from the script process. */
export function PlanScriptReport({
  report,
}: {
  readonly report: AgentPlanScriptAssessment | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!report) return null;
  return (
    <section
      className="mb-3 space-y-1"
      aria-label={t("plans.scripts.reportTitle")}
    >
      <h4 className="font-semibold">
        {t("plans.scripts.reportTitle")} ·{" "}
        {t(`plans.scripts.reportStatus.${report.status}`)}
      </h4>
      <p className="wrap-anywhere">{report.summary}</p>
      <p className="text-xs text-muted-foreground">
        {t("plans.scripts.reportCounts", {
          total: report.checkCount,
          failed: report.failedCount,
          partial: report.partialCount,
        })}
      </p>
    </section>
  );
}
