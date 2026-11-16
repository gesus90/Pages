import { useTranslation } from "react-i18next";

import { PlanPanelContext } from "./plan-panel-context";
import { PlanReloadButton } from "./plan-reload-button";
import { PlanWorkspaceConflict } from "./plan-workspace-conflict";
import { recoveryErrorText } from "./plan-recovery-panel";
import { PlanRunLog } from "./plan-run-log/plan-run-log";

import type { usePlanRecovery } from "./use-plan-recovery";
import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { usePlanEditor } from "./use-plan-editor";

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
