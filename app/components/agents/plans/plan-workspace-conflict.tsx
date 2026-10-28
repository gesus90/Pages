import { useTranslation } from "react-i18next";

import type { AgentPlanWorkspaceConflict } from "@/definition/AgentPlanWorkspaceConflict";

/** Names only this plan's affected nodes and authorized execution targets. */
export function PlanWorkspaceConflict({
  conflict,
}: {
  readonly conflict: AgentPlanWorkspaceConflict | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!conflict) return null;
  const nodes = conflict.nodes.map((node) => node.name).join(", ");
  const targets = conflict.targets
    .map((target) =>
      [target.connectionName, target.workspaceName, target.path]
        .filter((part) => part !== null)
        .join(" · "),
    )
    .join(", ");
  return (
    <div className="space-y-1 text-xs wrap-anywhere text-muted-foreground">
      <p>{t("plans.panel.workspaceConflictNodes", { nodes })}</p>
      <p>{t("plans.panel.workspaceConflictTargets", { targets })}</p>
      <p>{t(`plans.panel.workspaceConflictRemedy.${conflict.kind}`)}</p>
    </div>
  );
}
