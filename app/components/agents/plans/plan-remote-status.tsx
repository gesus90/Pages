import { useTranslation } from "react-i18next";
import type { AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";

/** Explains empty remote choices with separate installation, login and catalog facts. */
export function PlanRemoteStatus({
  sources,
  target,
}: {
  readonly sources: AgentPlanSources;
  readonly target: AgentPlanExecutionTarget;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (target.kind !== "remote") return null;
  const status = sources.remoteStatus?.find(
    (entry) => entry.workspaceId === target.workspaceId,
  );
  if (!status) return null;
  return (
    <div
      role="status"
      className="space-y-1 rounded-lg bg-muted p-3 text-xs text-muted-foreground"
    >
      {status.problem ? (
        <p>{t(`plans.panel.issueCause.${status.problem}`)}</p>
      ) : (
        <>
          {(["codex", "claude"] as const).map((tool) => {
            const entry = status.tools.find(
              (candidate) => candidate.tool === tool,
            );
            const reason = entry
              ? (entry.authentication ?? "unknown")
              : "missing";
            return (
              <p key={tool}>
                {t(`settings.agents.runner.toolName.${tool}`)} ·{" "}
                {t(`settings.agents.runner.auth.${reason}`)}
                {entry?.authentication === "authenticated" &&
                !entry.models?.length
                  ? ` · ${t("plans.panel.issueCause.remoteCatalog")}`
                  : ""}
              </p>
            );
          })}
          {!status.hasModelCatalog ? (
            <p>{t("plans.execution.catalogMissing")}</p>
          ) : null}
        </>
      )}
      <p>{t("plans.execution.remotePause")}</p>
      <a className="underline" href="/settings/agents">
        {t("plans.execution.runnerSettings")}
      </a>
    </div>
  );
}
