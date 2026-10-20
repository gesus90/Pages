import { useTranslation } from "react-i18next";

import type { AgentPlanRecoveryView } from "@/definition/AgentPlanRecovery";

function stepName(view: AgentPlanRecoveryView, id: string): string {
  return view.stepNames[id] ?? id;
}

/** State, failure point, last verified checkpoint and plan revisions of an ended run. */
export function PlanRecoveryState({
  view,
}: {
  readonly view: AgentPlanRecoveryView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { checkpoint, origin } = view;
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt className="font-medium text-foreground">
        {t("plans.recovery.stateLabel")}
      </dt>
      <dd>{t(`plans.recovery.state.${view.state}`)}</dd>
      <dt className="font-medium text-foreground">
        {t("plans.recovery.failedAt")}
      </dt>
      <dd>
        {view.nodes.length === 0 ? (
          t("plans.recovery.noFailure")
        ) : (
          <ul>
            {view.nodes.map((node) => (
              <li key={node.stepId}>
                {stepName(view, node.stepId)}
                {node.error
                  ? `: ${t(`settings.agents.error.${node.error}`, {
                      defaultValue: node.error,
                    })}`
                  : null}
              </li>
            ))}
          </ul>
        )}
      </dd>
      <dt className="font-medium text-foreground">
        {t("plans.recovery.checkpoint")}
      </dt>
      <dd>
        {checkpoint
          ? t("plans.recovery.checkpointValue", {
              version: checkpoint.version,
              step: stepName(view, checkpoint.stepId),
              time: new Date(checkpoint.completedAt).toLocaleString(),
            })
          : t("plans.recovery.checkpointNone")}
      </dd>
      <dt className="font-medium text-foreground">
        {t("plans.recovery.revisions")}
      </dt>
      <dd>
        {t("plans.recovery.revisionValue", {
          run: view.planRevision,
          current: view.currentPlanRevision,
        })}
      </dd>
      {origin ? (
        <>
          <dt className="font-medium text-foreground">
            {t("plans.recovery.originLabel")}
          </dt>
          <dd>
            {t(`plans.recovery.origin.${origin.kind}`, {
              run: origin.runId.slice(0, 8),
              mode: origin.mode ? t(`plans.recovery.mode.${origin.mode}`) : "",
              reused: origin.reusedStepIds.length,
              retried: origin.retriedStepIds.length,
            })}
          </dd>
        </>
      ) : null}
    </dl>
  );
}
