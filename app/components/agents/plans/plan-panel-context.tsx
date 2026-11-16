import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { planTeamsOf } from "@/definition/AgentPlanTeam";

import { planTeamName } from "./plan-management/plan-access-model";

import type { TFunction } from "i18next";
import type { AgentPlanPage, AgentPlanSummary } from "@/definition/AgentPlan";

/** The second line of a plan in the list: project, team badges and labels. */
function planDescription(
  page: AgentPlanPage,
  plan: AgentPlanSummary,
  translate: TFunction,
): string {
  const teams = planTeamsOf(plan).map((team) =>
    translate("plans.access.teamBadge", {
      name: planTeamName(page.directory, team),
    }),
  );
  return [
    plan.isWorkspaceMissing
      ? `${plan.projectName} · ${translate("plans.manage.withoutWorkspace")}`
      : plan.projectName,
    ...teams,
    plan.isAdminAccess ? translate("plans.access.adminBadge") : null,
    plan.oneShot ? translate("plans.manage.oneShotBadge") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * „Plan öffnen“: the choice of another plan, and nothing else.
 *
 * @remarks
 * Name, project and workspace change in the Bearbeiten dialog of the plan
 * menu, teams and owner in its Teams dialog; opening another plan asks first
 * when the draft has unsaved changes.
 */
export function PlanPanelContext({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (page.plans.length === 0) return null;
  return (
    <label className="grid max-w-sm min-w-0 gap-1.5 text-xs font-medium">
      {t("plans.panel.openPlan")}
      <Select
        ariaLabel={t("plans.panel.openPlan")}
        value={page.selected?.id ?? ""}
        placeholder={t("plans.manage.choosePlan")}
        options={page.plans.map((plan) => ({
          value: plan.id,
          label: plan.name,
          description: planDescription(page, plan, t),
        }))}
        onValueChange={(id) => {
          void navigate(`/agents/plans?planId=${encodeURIComponent(id)}`);
        }}
        className="w-full min-w-0 [&>span]:truncate"
      />
    </label>
  );
}
