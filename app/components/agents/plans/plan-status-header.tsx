import { ChevronDown, ChevronUp, Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanPaletteButton } from "./plan-palette-button";
import { PlanStatusSequence } from "./plan-status-sequence";
import { PlanStatusDonut } from "./plan-status-donut";
import { PlanStatusTodoCount } from "./plan-status-todo-count";
import { PlanPendingSequence } from "./plan-status-pending";
import { elapsedTime } from "./plan-run-status-model";
import { hasOpenPlanReport } from "./plan-status";

import type { TFunction } from "i18next";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanSequencePreview } from "./plan-run-status-model";
import type { PlanStepSequence } from "./plan-step-sequence";

interface StatusHeaderProps {
  readonly run: AgentPlanRun | null;
  /** The numbered executions of the run, or the outlook of the plan before it runs. */
  readonly sequence: PlanStepSequence;
  /** Agents, scripts and loops of the plan that get no number. */
  readonly gaps: PlanSequencePreview["gaps"];
  readonly end: string | null;
  readonly selectedKey: string | null;
  readonly isOpen: boolean;
  readonly contentId: string;
  readonly error: string | null;
  /** Whether the plan may start, named while there is no run; absent while unknown. */
  readonly isReady?: boolean;
  readonly onSelect: (id: string) => void;
  readonly onToggle: () => void;
}

/** What the indicator names: the run's state, or whether the plan may start without one. */
function indicatorStatus(
  run: AgentPlanRun | null,
  isReady: boolean | undefined,
): string {
  const isBlocked =
    run?.status === "running" &&
    run.steps.some((step) => step.isBlocked) &&
    !run.steps.some((step) => step.status === "running");
  if (isBlocked) return "blocked";
  if (run?.status === "succeeded" && run.steps.some(hasOpenPlanReport))
    return "reportOpen";
  return run?.status ?? (isReady === false ? "notReady" : "idle");
}

const DOT_TONES: Readonly<Record<string, string>> = {
  succeeded: "bg-plan-progress-done",
  reportOpen: "bg-warning",
  notReady: "bg-status-active",
  idle: "bg-muted-foreground",
  cancelled: "bg-muted-foreground",
  paused: "bg-muted-foreground",
  failed: "bg-destructive",
  blocked: "bg-destructive",
};

function RunIndicator({
  run,
  error,
  isReady,
}: Pick<StatusHeaderProps, "run" | "error" | "isReady">): React.ReactElement {
  const { t } = useTranslation();
  const status = indicatorStatus(run, isReady);
  const label = error
    ? t("plans.progress.unavailable")
    : t(`plans.progress.state.${status}`);
  const tone = error ? "bg-destructive" : (DOT_TONES[status] ?? "bg-primary");
  return (
    <span
      title={label}
      className="flex max-w-32.5 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.75 text-xs leading-4.5 font-semibold"
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", tone)}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** The counter's text: the current position and the total, marked when the total is an estimate. */
function positionText(
  sequence: PlanStepSequence,
  translate: TFunction,
): string {
  const total = sequence.blocks.length;
  const position = sequence.position > 0 ? String(sequence.position) : "–";
  return translate(
    sequence.isEstimate
      ? "plans.progress.positionEstimate"
      : "plans.progress.position",
    { position, total },
  );
}

/** Position and total of the sequence, apart from the executions that completed. */
function RunDonut({
  sequence,
}: Pick<StatusHeaderProps, "sequence">): React.ReactElement {
  const { t } = useTranslation();
  const { completed } = sequence;
  const total = sequence.blocks.length;
  const position = positionText(sequence, t);
  const label = t("plans.progress.positionLabel", {
    position,
    completed,
  });
  return (
    <div
      className="flex shrink-0 items-center gap-1.75 border-l border-border pl-3"
      role="img"
      title={total ? label : undefined}
      aria-label={total ? label : t("plans.progress.unknownTotal")}
    >
      <PlanStatusDonut completed={completed} total={total} />
      <span aria-hidden="true" className="min-w-0">
        <span className="block text-xs leading-4 font-medium whitespace-nowrap tabular-nums">
          {total ? position : "—"}
        </span>
        {total ? (
          <span className="block text-[0.6875rem] leading-3.5 whitespace-nowrap text-muted-foreground tabular-nums">
            {t("plans.progress.completedCount", { count: completed })}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** The existing status head with an independent checklist count before the clock. */
export function PlanStatusHeader(props: StatusHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  const toggle = t(
    props.isOpen ? "plans.progress.close" : "plans.progress.open",
  );
  const duration = elapsedTime(props.run?.startedAt, props.end);
  return (
    <div className="flex min-h-11.5 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 @2xl/status:flex-nowrap">
      <RunIndicator
        run={props.run}
        error={props.error}
        isReady={props.isReady}
      />
      <RunDonut sequence={props.sequence} />
      <div className="order-2 flex w-full min-w-0 border-border @2xl/status:order-none @2xl/status:w-auto @2xl/status:flex-1 @2xl/status:border-l">
        {props.run && props.sequence.blocks.length ? (
          <PlanStatusSequence
            run={props.run}
            blocks={props.sequence.blocks}
            anchorKey={props.sequence.anchorKey}
            selectedKey={props.selectedKey}
            onSelect={props.onSelect}
          />
        ) : (
          <PlanPendingSequence
            blocks={props.sequence.blocks}
            gaps={props.gaps}
            error={props.error}
          />
        )}
      </div>
      <div className="order-1 ml-auto flex shrink-0 items-center gap-x-3 @2xl/status:order-none @2xl/status:ml-0">
        <PlanStatusTodoCount
          step={
            props.sequence.blocks.find(
              (block) => block.key === props.selectedKey,
            )?.result
          }
        />
        <span
          title={t("plans.progress.elapsed")}
          aria-label={`${t("plans.progress.elapsed")}: ${duration}`}
          className="flex shrink-0 items-center gap-1.5 border-l border-border pl-3 text-xs leading-4.5 font-medium tabular-nums"
        >
          <Clock3 aria-hidden="true" className="size-4" />
          {duration}
        </span>
        <div className="shrink-0 border-l border-border pl-2.5">
          <PlanPaletteButton
            variant="outline"
            size="icon-sm"
            tooltip={toggle}
            aria-label={toggle}
            aria-expanded={props.isOpen}
            aria-controls={props.contentId}
            onClick={props.onToggle}
            className="size-8 min-h-8 rounded-md bg-surface-hover p-0 xl:size-8 xl:min-h-8 xl:p-0 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:min-h-11"
          >
            {props.isOpen ? (
              <ChevronDown aria-hidden="true" className="size-4" />
            ) : (
              <ChevronUp aria-hidden="true" className="size-4" />
            )}
          </PlanPaletteButton>
        </div>
      </div>
    </div>
  );
}
