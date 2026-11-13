import { useTranslation } from "react-i18next";

import type { AgentPlanStartOwner } from "@/definition/AgentPlanResourceRelease";

/** Names every run Starten will stop, including runs of other plans on the same write resources. */
export function PlanStartOwners({ owners }: { readonly owners: readonly AgentPlanStartOwner[] }): React.ReactElement | null {
  const { t } = useTranslation();
  if (owners.length === 0) return null;
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>{t("plans.openRun.affected")}</p>
      <ul className="list-disc space-y-1 ps-5">
        {owners.map((owner) => (
          <li key={owner.runId}>{owner.planName} · {owner.runId} · {owner.startedAt}</li>
        ))}
      </ul>
    </div>
  );
}
