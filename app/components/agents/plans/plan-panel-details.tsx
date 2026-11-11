import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PlanPanelContext } from "./plan-panel-context";
import { PlanPanelIssueList } from "./plan-panel-issues";
import { PlanReloadButton } from "./plan-reload-button";
import { PlanWorkspaceConflict } from "./plan-workspace-conflict";
import { PlanStartRejection } from "./plan-start-rejection";
import { recoveryErrorText } from "./plan-recovery-panel";
import { PlanStartHistory } from "./plan-start-history";
import { PlanEntryResultsOverview } from "./plan-entry-results";

import type { usePlanRecovery } from "./use-plan-recovery";
import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { PlanPanelIssue } from "./plan-panel-issues";
import type { usePlanEditor } from "./use-plan-editor";

/** Opens the run view of the plan: every run, whoever started it (PAGE-307). */
function PlanRunsLink({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (page.selected === null) return null;
  return (
    <Link
      to={`/agents/runs?planId=${encodeURIComponent(page.selected.id)}`}
      className="inline-block text-xs font-medium text-primary-text hover:text-primary-text-hover"
    >
      {t("plans.panel.allRuns")}
    </Link>
  );
}

/** The longer explanations of the run state that the status line names briefly. */
function PlanPanelNotes({
  control,
}: {
  readonly control: AgentPlanControl | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const notes = [
    control?.status === "pausing" ? t("plans.panel.pausingHint") : null,
    control?.status === "paused" ? t("plans.panel.pausedHint") : null,
    control?.status === "stopping" ? t("plans.panel.stoppingHint") : null,
  ].filter((note) => note !== null);
  if (notes.length === 0) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}

/**
 * The expanded part of the panel: findings, refusals, run notes, recovery and the plan choice.
 *
 * @remarks
 * Opening it reads nothing new and changes neither the plan nor the run.
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
  /** The run the canvas shows; its file entries get their own result overview. */
  readonly run?: AgentPlanRun | null;
  readonly issues: readonly PlanPanelIssue[];
  /** A refusal that no finding explains, as an error code. */
  readonly error: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { page, error } = props;
  return (
    <div id={props.id} className="space-y-4 border-t border-border px-4 py-3.5">
      <PlanPanelIssueList issues={props.issues} />
      <PlanEntryResultsOverview
        plan={props.editor.draft}
        run={props.run ?? null}
      />
      {props.recoveryRunId && props.recovery?.error ? (
        <p role="alert" className="text-xs text-destructive">
          {recoveryErrorText(t, props.recovery.error)}
        </p>
      ) : null}
      <PlanWorkspaceConflict conflict={props.control?.workspaceConflict} />
      <PlanStartRejection rejection={props.control?.lastStartRejection} />
      {page.selected?.canEdit && props.control?.lastStartRejection ? (
        <PlanStartHistory
          key={`${page.selected.id}:${props.control.lastStartRejection.id}`}
          planId={page.selected.id}
          latestId={props.control.lastStartRejection.id}
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-2 text-xs text-destructive"
        >
          {t(`settings.agents.error.${error}`, {
            defaultValue: t("plans.panel.error"),
          })}
          {error === "plan_conflict" ? <PlanReloadButton /> : null}
        </p>
      ) : null}
      {page.selected?.canEdit === false ? (
        <p className="text-xs wrap-anywhere text-muted-foreground">
          {t("plans.flow.storage.readOnly")}
        </p>
      ) : null}
      <PlanPanelNotes control={props.control} />
      <PlanRunsLink page={page} />
      <PlanPanelContext page={page} />
    </div>
  );
}
