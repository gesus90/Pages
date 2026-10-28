import { useTranslation } from "react-i18next";

import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";

function StartRejectionIssues({
  rejection,
}: {
  readonly rejection: AgentPlanStartRejection;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {rejection.issues?.length ? (
        <ul className="list-inside list-disc">
          {rejection.issues.map((issue, index) => (
            <li
              key={`${issue.nodeId ?? "plan"}:${issue.port ?? ""}:${issue.problem}:${index}`}
            >
              {[
                issue.nodeId,
                issue.port,
                t(`plans.validation.${issue.problem}`),
              ]
                .filter((part) => part !== null && part !== "")
                .join(" · ")}
            </li>
          ))}
        </ul>
      ) : null}
      {rejection.issueDetailsFiltered ? (
        <p>{t("plans.panel.rejectionIssuesFiltered")}</p>
      ) : null}
    </>
  );
}

/** A historical refusal stays distinct from the current Play availability. */
export function PlanStartRejection({
  rejection,
  isHistorical = false,
}: {
  readonly rejection: AgentPlanStartRejection | undefined;
  readonly isHistorical?: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!rejection) return null;
  const nodes = rejection.conflict?.nodes.map((node) => node.name).join(", ");
  const targets = rejection.conflict?.targets
    .map((target) =>
      [target.connectionName, target.workspaceName, target.path]
        .filter((part) => part !== null)
        .join(" · "),
    )
    .join(", ");
  return (
    <section className="space-y-1 text-xs wrap-anywhere text-muted-foreground">
      <p className="font-medium text-foreground">
        {t(
          isHistorical
            ? "plans.panel.historicalStartRejection"
            : "plans.panel.lastStartRejection",
          {
            time: new Date(rejection.createdAt).toLocaleString(),
            revision: rejection.planRevision,
          },
        )}
      </p>
      {!rejection.isSavedRevision ? (
        <p>{t("plans.panel.rejectedDraft")}</p>
      ) : null}
      {rejection.error !== "plan_workspace_conflict" ? (
        <p>
          {t(`settings.agents.error.${rejection.error}`, {
            defaultValue: t("plans.panel.rejectionOther"),
          })}{" "}
          ({rejection.error})
        </p>
      ) : null}
      <StartRejectionIssues rejection={rejection} />
      <p>{t(`plans.panel.rejectionReservation.${rejection.reservation}`)}</p>
      {rejection.conflict ? (
        <>
          {nodes ? (
            <p>{t("plans.panel.workspaceConflictNodes", { nodes })}</p>
          ) : null}
          {targets ? (
            <p>{t("plans.panel.workspaceConflictTargets", { targets })}</p>
          ) : null}
          <p>{t(`plans.panel.rejectionRemedy.${rejection.conflict.kind}`)}</p>
        </>
      ) : null}
      {!rejection.conflict && rejection.error === "plan_workspace_conflict" ? (
        <p>{t("plans.panel.rejectionDetailsUnavailable")}</p>
      ) : null}
      {rejection.targetResolution === "remote_registered" ||
      rejection.targetResolution === "mixed" ? (
        <p>{t("plans.panel.rejectionRemoteIdentity")}</p>
      ) : null}
    </section>
  );
}
