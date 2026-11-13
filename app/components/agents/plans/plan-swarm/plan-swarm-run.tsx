import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanSwarmLane, PlanSwarmTodoProgress } from "./plan-swarm-lane";
import { planSwarmRunState } from "./plan-swarm-model";

import type { AgentPlanSwarmRun } from "@/definition/AgentPlanSwarmRun";

/** The violations of areas and locks, with their files behind a toggle. */
function Violations(props: {
  readonly run: AgentPlanSwarmRun;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);
  const { violations } = props.run;
  if (violations.length === 0) return null;
  const Arrow = isOpen ? ChevronDown : ChevronRight;
  return (
    <div
      className="rounded-md border border-warning/40 bg-warning-subtle px-2 py-1.5 text-xs text-warning"
      data-plan-swarm-violations
    >
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen(!isOpen)}
        className="flex items-center gap-1 text-left font-semibold"
      >
        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        {t("plans.swarm.violations", { count: violations.length })}
        <Arrow aria-hidden="true" className="size-3.5" />
      </button>
      {isOpen ? (
        <ul className="mt-1 flex flex-col gap-0.5 wrap-anywhere text-foreground">
          {violations.map((violation) => (
            <li
              key={`${violation.at}-${violation.kind}-${violation.taskId ?? ""}`}
            >
              {t(`plans.swarm.violation.${violation.kind}`, {
                workers: violation.workerIds.join(", "),
                files: violation.files.join(", "),
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The lane of the main model, with the swarm tint. */
function MainLane(props: {
  readonly run: AgentPlanSwarmRun;
}): React.ReactElement {
  const { t } = useTranslation();
  const { main } = props.run;
  return (
    <div
      className="flex min-h-14 flex-col gap-1.5 bg-plan-swarm-subtle px-3 py-2 text-xs"
      data-plan-swarm-main
    >
      <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-x-2 @xl/swarm:grid-cols-[3.75rem_11.875rem_minmax(0,1fr)_8.125rem]">
        <span className="font-semibold text-plan-swarm">
          {t("plans.swarm.mainShort")}
        </span>
        <span className="min-w-0 truncate">{main.model || main.provider}</span>
        <span className="col-span-2 min-w-0 truncate text-muted-foreground @xl/swarm:col-span-1">
          {main.activity ?? t("plans.swarm.mainIdle")}
        </span>
        <span className="hidden @xl/swarm:flex">
          <PlanSwarmTodoProgress todos={main.todos} />
        </span>
      </div>
      <Violations run={props.run} />
    </div>
  );
}

/** Placeholder lanes in the number of helpers while the run loads. */
function LoadingLanes(props: { readonly count: number }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ul
      aria-busy="true"
      aria-label={t("plans.swarm.loading")}
      data-plan-swarm-loading
    >
      {Array.from({ length: props.count }, (_, index) => (
        <li
          key={index}
          className="flex h-13 items-center border-t border-border px-3"
        >
          <span className="h-3 w-full rounded bg-muted motion-safe:animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

/**
 * The run view of a swarm: the main lane on top and one lane per helper below (PAGE-313).
 *
 * @remarks
 * Lanes stand below each other, not beside each other, with the same columns
 * in every row; each row opens below itself while the others stay visible.
 * A failure of the node shows as a bar on top and leaves the lanes readable.
 */
export function PlanSwarmRun(props: {
  readonly run: AgentPlanSwarmRun | undefined;
  /** How many placeholder lanes show while the run loads. */
  readonly workerCount: number;
  /** The reason of a failed node, shown in a bar on top. */
  readonly error?: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { run } = props;
  const state = planSwarmRunState(run);
  return (
    <section
      aria-label={t("plans.swarm.runLabel")}
      className="@container/swarm flex min-w-0 flex-col overflow-hidden rounded-lg border border-border"
      data-plan-swarm-run={state}
    >
      {props.error ? (
        <p
          role="alert"
          className="border-b border-destructive/40 bg-destructive-subtle px-3 py-2 text-xs text-destructive wrap-anywhere"
        >
          {t("plans.swarm.nodeFailed", { reason: props.error })}
        </p>
      ) : null}
      {run ? <MainLane run={run} /> : null}
      {state === "empty" ? (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {t("plans.swarm.empty")}
        </p>
      ) : null}
      {run ? (
        <ul aria-label={t("plans.swarm.workers")}>
          {run.workers.map((worker) => (
            <PlanSwarmLane
              key={worker.id}
              worker={worker}
              task={
                run.tasks.find((task) => task.id === worker.taskId) ??
                run.tasks.findLast((task) => task.workerId === worker.id)
              }
            />
          ))}
        </ul>
      ) : (
        <LoadingLanes count={props.workerCount} />
      )}
      {run?.summary ? (
        <p
          className={cn(
            "border-t border-border px-3 py-2 text-xs wrap-anywhere whitespace-pre-wrap",
          )}
        >
          <span className="mr-2 font-semibold text-muted-foreground uppercase">
            {t("plans.swarm.result")}
          </span>
          {run.summary}
        </p>
      ) : null}
    </section>
  );
}
