import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";

import { PlanRunSequence, planRunAgents } from "./plan-run-sequence";
import { PlanStatusBadge } from "./plan-status";
import { PlanRunDiagnostics } from "./plan-run-diagnostics";
import { PlanRunGroupSessions } from "./plan-run-group-sessions";

import type { usePlanRun } from "./use-plan-run";

/**
 * Results contain only final sanitized text, never snapshots, credentials or native diagnostics.
 *
 * @remarks
 * It sits in the run details panel below the grid, which supplies the frame.
 */
export function PlanRunView(props: {
  readonly state: ReturnType<typeof usePlanRun>;
  readonly onStop: (id: string) => void;
  readonly isPending: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { run } = props.state;
  const agents = run ? planRunAgents(run) : [];
  const completed = agents.filter((step) => step.status === "succeeded").length;
  return (
    <section className="min-w-0 space-y-4" aria-label={t("plans.runView")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="sr-only">{t("plans.runView")}</h2>
        <Select
          ariaLabel={t("plans.history")}
          value={props.state.selectedId}
          onValueChange={props.state.select}
          options={props.state.runs.map((entry) => ({
            value: entry.id,
            label: `${entry.startedAt} · ${t(`plans.status.${entry.status}`)}`,
          }))}
        />
      </div>
      {props.state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`settings.agents.error.${props.state.error}`)}
        </p>
      ) : null}
      {run ? (
        <>
          <div className="flex items-center gap-3">
            <p role="status" className="text-sm">
              <PlanStatusBadge status={run.status} />
              <span className="ml-2 text-muted-foreground">
                {t("plans.agentProgress", { completed, total: agents.length })}
              </span>
            </p>
            {run.status === "running" || run.status === "paused" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={props.isPending || run.stopRequested}
                onClick={() => props.onStop(run.id)}
              >
                {t(run.stopRequested ? "plans.stopRequested" : "plans.stop")}
              </Button>
            ) : null}
          </div>
          <progress
            className="h-1.5 w-full accent-success"
            aria-label={t("plans.progress")}
            value={completed}
            max={Math.max(1, agents.length)}
          />
          <PlanRunSequence key={run.id} run={run} />
          <PlanRunGroupSessions run={run} />
          <PlanRunDiagnostics run={run} agents={agents} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("plans.noRuns")}</p>
      )}
    </section>
  );
}
