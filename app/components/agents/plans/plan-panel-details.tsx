import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { Select } from "@/app/components/ui/select";
import { planTeamsOf } from "@/definition/AgentPlanTeam";

import { planTeamName } from "./plan-management/plan-access-model";
import { PlanReloadButton } from "./plan-reload-button";
import { recoveryErrorText } from "./plan-recovery-panel";
import { PlanRunLog } from "./plan-run-log/plan-run-log";

import type { TFunction } from "i18next";
import type {
  AgentPlanPage,
  AgentPlanRun,
  AgentPlanSummary,
} from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanWorkspaceConflict } from "@/definition/AgentPlanWorkspaceConflict";
import type { usePlanEditor } from "./use-plan-editor";
import type { usePlanRecovery } from "./use-plan-recovery";

/**
 * What keeps the plan from starting or continuing, as one short line.
 * @remarks
 * The status line names the state; graph findings stay at their nodes, so
 * this never lists them. A code the refused action already reports is not
 * repeated.
 */
function PlanPanelBlock({
  code,
  error,
}: {
  readonly code: string | null;
  readonly error: string | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!code || code === error) return null;
  return (
    <p className="text-xs wrap-anywhere text-status-active">
      {t(`settings.agents.error.${code}`, {
        defaultValue: t("plans.panel.error"),
      })}
    </p>
  );
}

function PlanPanelError({
  error,
}: {
  readonly error: string | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p
      role="alert"
      className="flex flex-wrap items-center gap-2 text-xs text-destructive"
    >
      {t(`settings.agents.error.${error}`, {
        defaultValue: t("plans.panel.error"),
      })}
      {error === "plan_conflict" ? <PlanReloadButton /> : null}
    </p>
  );
}

function PlanPanelRecoveryAlert({
  recoveryRunId,
  recovery,
}: {
  readonly recoveryRunId?: string | null;
  readonly recovery?: ReturnType<typeof usePlanRecovery>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!recoveryRunId || !recovery?.error) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {recoveryErrorText(t, recovery.error)}
    </p>
  );
}

/**
 * The expanded part of the panel: the plan choice and the log of the shown run.
 * @remarks
 * Below the controls it holds „Plan öffnen“ and the „Laufprotokoll“ only.
 * What keeps the plan from starting or continuing now and a refused action
 * stay above them as short lines while they apply; graph findings are read
 * at their nodes, the run state in the status line, and consumption,
 * earlier start refusals, cleanups and other runs elsewhere. Opening it
 * changes neither the plan nor the run, and hiding something here deletes
 * nothing and lifts no block.
 */
export function PlanPanelDetails(props: {
  /** @deprecated The upper run controls own recovery; retained for callers of the details projection. */
  readonly recoveryRunId?: string | null;
  /** @deprecated Not rendered by the details projection. */
  readonly recovery?: ReturnType<typeof usePlanRecovery>;
  readonly id: string;
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly control: AgentPlanControl | undefined;
  /** The run the canvas shows; the log holds its messages only. */
  readonly run?: AgentPlanRun | null;
  /** What keeps the plan from starting or continuing, as an error code. */
  readonly code: string | null;
  /** A refusal that no finding explains, as an error code. */
  readonly error: string | null;
}): React.ReactElement {
  const { page, error } = props;
  return (
    <div id={props.id} className="space-y-4 border-t border-border px-4 py-3.5">
      <PlanPanelRecoveryAlert
        recoveryRunId={props.recoveryRunId}
        recovery={props.recovery}
      />
      <PlanWorkspaceConflict conflict={props.control?.workspaceConflict} />
      <PlanPanelBlock code={props.code} error={error} />
      <PlanPanelError error={error} />
      <PlanPanelContext page={page} />
      <PlanRunLog run={props.run ?? null} />
    </div>
  );
}

function PlanWorkspaceConflict({
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

function PlanPanelContext({
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
