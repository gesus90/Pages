import { useTranslation } from "react-i18next";

import type { AgentPlanAcceptance } from "@/definition/AgentPlanSession";

const REPORT_ISSUES: Readonly<Record<string, string>> = {
  report_missing: "missing",
  report_invalid: "invalid",
  todo_open: "todoOpen",
  todo_missing: "todoMissing",
  criterion_missing: "criterionMissing",
  criterion_unmet: "criterionUnmet",
  evidence_missing: "evidenceMissing",
  ticket_unchecked: "ticketUnchecked",
  ticket_unreadable: "ticketUnreadable",
  ticket_changed: "ticketChanged",
};

/** Separates a recorded report assessment from the process outcome. */
export function PlanStatusReport({
  acceptance,
}: {
  readonly acceptance: AgentPlanAcceptance | null | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!acceptance) return null;
  return (
    <section className="mb-3 space-y-1" aria-label={t("plans.progress.report")}>
      <h4 className="font-semibold">
        {t("plans.progress.report")} ·{" "}
        {t(`plans.progress.reportVerdict.${acceptance.verdict}`)}
      </h4>
      {acceptance.summary ? (
        <p className="wrap-anywhere">{acceptance.summary}</p>
      ) : null}
      {acceptance.issues.length ? (
        <ul className="list-inside list-disc text-warning">
          {acceptance.issues.map((issue, index) => {
            const separator = issue.indexOf(":");
            const code = separator < 0 ? issue : issue.slice(0, separator);
            const id = separator < 0 ? "" : issue.slice(separator + 1);
            const key = REPORT_ISSUES[code];
            return (
              <li key={`${issue}-${index}`} className="wrap-anywhere">
                {key
                  ? t(`plans.progress.reportIssue.${key}`, { id })
                  : t("plans.progress.reportIssue.other", { issue })}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
