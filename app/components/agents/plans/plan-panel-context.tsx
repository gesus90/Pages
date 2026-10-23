import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { AgentPlanPage } from "@/definition/AgentPlan";

/**
 * Opens another plan and says, without a way to change it, which team shares this one.
 *
 * @remarks
 * Name, project and workspace change in the Bearbeiten dialog of the plan
 * menu; opening another plan asks first when the draft has unsaved changes.
 */
export function PlanPanelContext({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      {page.plans.length > 0 ? (
        <label className="grid max-w-sm min-w-0 gap-1.5 text-xs font-medium">
          {t("plans.panel.openPlan")}
          <Select
            ariaLabel={t("plans.panel.openPlan")}
            value={page.selected?.id ?? ""}
            placeholder={t("plans.manage.choosePlan")}
            options={page.plans.map((plan) => ({
              value: plan.id,
              label: plan.name,
              description: plan.projectName,
            }))}
            onValueChange={(id) => {
              void navigate(`/agents/plans?planId=${encodeURIComponent(id)}`);
            }}
            className="w-full min-w-0 [&>span]:truncate"
          />
        </label>
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

/** Says which team shares the plan and who moves it to another project. */
function PlanPanelTeam({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const departmentId = page.selected
    ? (page.selected.departmentId ?? null)
    : (page.teamDepartmentId ?? null);
  const department = page.directory.departments.find(
    (entry) => entry.id === departmentId,
  );
  let text = t("plans.panel.team.none");
  if (departmentId !== null)
    text = t(
      page.selected ? "plans.panel.team.shared" : "plans.panel.team.new",
      {
        name: department?.name ?? t("plans.panel.team.unknown"),
      },
    );
  return (
    <>
      <p className="text-xs wrap-anywhere text-muted-foreground" data-plan-team>
        {text}
      </p>
      {page.selected?.canEdit && page.selected.ownerId !== page.userId ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.panel.projectOwnerOnly")}
        </p>
      ) : null}
    </>
  );
}
