import { useTranslation } from "react-i18next";

import type { AgentPlanRecoveryView } from "@/definition/AgentPlanRecovery";

/** A stored scan failure remains historical after a later successful cleanup. */
export function PlanCleanupHistory({
  view,
}: {
  readonly view: AgentPlanRecoveryView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const failure = view.latestCleanupFailure;
  if (!failure) return null;
  return (
    <>
      <dt className="font-medium text-foreground">
        {t("plans.recovery.cleanupHistory")}
      </dt>
      <dd className="space-y-1">
        <p>
          {t("plans.recovery.cleanupHistoryTime", {
            time: new Date(failure.createdAt).toLocaleString(),
            revision: failure.planRevision,
          })}
        </p>
        <p>
          {t(`plans.recovery.cleanupFailure.${failure.reason}`, {
            step: view.stepNames[failure.stepId] ?? failure.stepId,
            resource: t(`plans.recovery.cleanupKind.${failure.kind}`),
          })}
        </p>
        <p>{t("plans.recovery.cleanupHistoryHint")}</p>
      </dd>
    </>
  );
}
