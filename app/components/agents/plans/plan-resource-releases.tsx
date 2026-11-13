import { useTranslation } from "react-i18next";

import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Shows cleanup hints on the new run and the durable forced-release history on the old run. */
export function PlanResourceReleases({ run }: { readonly run: AgentPlanRun | null }): React.ReactElement | null {
  const { t } = useTranslation();
  if (!run?.startCleanupUnconfirmed?.length && !run?.resourceReleases?.length) return null;
  return (
    <div role="status" className="space-y-2 px-4 py-2 text-xs text-muted-foreground">
      {run.startCleanupUnconfirmed?.length ? (
        <p>{t("plans.openRun.cleanupHint", { runs: run.startCleanupUnconfirmed.join(", ") })}</p>
      ) : null}
      {run.resourceReleases?.map((release) => (
        <div key={release.id} className="space-y-1">
          <p>{t("plans.openRun.releaseHistory", { user: release.userId, at: release.createdAt, run: release.targetRunId })}</p>
          <p>{release.resources.join(", ")}</p>
          <ul className="list-disc ps-5">
            {release.processes.map((process, index) => (
              <li key={`${process.instanceId}:${index}`}>
                {process.instanceId} · {process.processId ?? "—"} · {t(process.confirmed ? "plans.openRun.processEnded" : "plans.openRun.processUnconfirmed")}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
