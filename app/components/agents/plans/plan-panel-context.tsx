import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
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
 * Opens another plan and says, without a way to change it, which teams share this one.
 *
 * @remarks
 * Name, project and workspace change in the Bearbeiten dialog of the plan
 * menu, teams and owner in its Teams dialog; opening another plan asks first
 * when the draft has unsaved changes. "Meine Teams" narrows the list to the
 * plans of the person's own teams (PAGE-329).
 */
export function PlanPanelContext({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isTeamsOnly, setTeamsOnly] = useState(false);
  const plans = isTeamsOnly
    ? page.plans.filter(
        (plan) => plan.isTeamMember === true || plan.id === page.selected?.id,
      )
    : page.plans;
  return (
    <div className="space-y-3">
      {page.plans.length > 0 ? (
        <div className="grid max-w-sm min-w-0 gap-1.5">
          <label className="grid min-w-0 gap-1.5 text-xs font-medium">
            {t("plans.panel.openPlan")}
            <Select
              ariaLabel={t("plans.panel.openPlan")}
              value={page.selected?.id ?? ""}
              placeholder={t("plans.manage.choosePlan")}
              options={plans.map((plan) => ({
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
          <label className="flex items-center gap-2 text-xs [@media(pointer:coarse)]:min-h-11">
            <Checkbox
              checked={isTeamsOnly}
              onChange={(event) => setTeamsOnly(event.target.checked)}
              data-plan-filter-teams
            />
            {t("plans.access.myTeams")}
          </label>
        </div>
      ) : null}
      <PlanPanelTeam page={page} />
      <Link
        className="inline-block rounded text-xs text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        to="/agents/workspaces"
      >
        {t("plans.panel.manageWorkspaces")}
      </Link>
    </div>
  );
}

/** Says which teams share the plan and who moves it to another project. */
function PlanPanelTeam({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const selected = page.selected;
  let text = t("plans.panel.team.none");
  if (selected) {
    const names = planTeamsOf(selected).map((team) =>
      planTeamName(page.directory, team),
    );
    if (names.length > 0)
      text = t("plans.access.sharedWith", { names: names.join(", ") });
  } else if (page.teamDepartmentId) {
    const department = page.directory.departments.find(
      (entry) => entry.id === page.teamDepartmentId,
    );
    text = t("plans.panel.team.new", {
      name: department?.name ?? t("plans.panel.team.unknown"),
    });
  }
  return (
    <>
      <p className="text-xs wrap-anywhere text-muted-foreground" data-plan-team>
        {text}
      </p>
      {selected?.canEdit && selected.ownerId !== page.userId ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.panel.projectOwnerOnly")}
        </p>
      ) : null}
    </>
  );
}
