import { ChevronDown, ChevronUp, Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanPaletteButton } from "./plan-palette-button";
import { PlanStatusSequence } from "./plan-status-sequence";
import { PlanStatusDonut } from "./plan-status-donut";
import { PlanStatusTodoCount } from "./plan-status-todo-count";
import { elapsedTime } from "./plan-run-status-model";
import { hasOpenPlanReport } from "./plan-status";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { PlanSequencePreview } from "./plan-run-status-model";

const CHEVRON_SHAPE =
  "[clip-path:polygon(0_0,74%_0,100%_50%,74%_100%,0_100%,25%_50%)]";

interface StatusHeaderProps {
  readonly run: AgentPlanRun | null;
  readonly preview: PlanSequencePreview;
  readonly steps: readonly AgentPlanStepResult[];
  readonly end: string | null;
  readonly anchorId: string | null;
  readonly selectedId: string | null;
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

function RunDonut({
  steps,
  preview,
}: Pick<StatusHeaderProps, "steps" | "preview">): React.ReactElement {
  const { t } = useTranslation();
  const completed = steps.filter((step) => step.status === "succeeded").length;
  const total = steps.length || preview.steps.length;
  const label = t("plans.progress.count", { completed, total });
  return (
    <div
      className="flex shrink-0 items-center gap-1.75 border-l border-border pl-3"
      role="img"
      aria-label={total ? label : t("plans.progress.unknownTotal")}
    >
      <PlanStatusDonut completed={completed} total={total} />
      <span aria-hidden="true" className="min-w-0">
        <span className="block text-xs leading-4.5 font-medium tabular-nums">
          {total ? `${completed}/${total}` : "—"}
        </span>
        <span className="sr-only">{t("plans.progress.completed")}</span>
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
      <RunDonut steps={props.steps} preview={props.preview} />
      <div className="flex w-full min-w-0 border-border @2xl/status:w-auto @2xl/status:flex-1 @2xl/status:border-l">
        {props.run && props.steps.length ? (
          <PlanStatusSequence
            run={props.run}
            steps={props.steps}
            anchorId={props.anchorId}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
          />
        ) : (
          <PlanPendingSequence preview={props.preview} error={props.error} />
        )}
      </div>
      <PlanStatusTodoCount
        step={props.steps.find((step) => step.id === props.selectedId)}
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
          className="size-8 min-h-8 rounded-md bg-surface-hover/80 p-0 xl:size-8 xl:min-h-8 xl:p-0 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:min-h-11"
        >
          {props.isOpen ? (
            <ChevronDown aria-hidden="true" className="size-4" />
          ) : (
            <ChevronUp aria-hidden="true" className="size-4" />
          )}
        </PlanPaletteButton>
      </div>
    </div>
  );
}

/**
 * Pending plan steps are a preview only; no run or execution evidence is synthesized.
 *
 * @remarks
 * The numbers follow the flow edges. Flow nodes that Start does not reach or
 * that lie in a cycle follow without a number and are marked as such.
 */
function PlanPendingSequence({
  preview,
  error,
}: {
  readonly preview: PlanSequencePreview;
  readonly error: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  if (error || (preview.steps.length === 0 && preview.gaps.length === 0))
    return (
      <p className="px-3 text-xs text-muted-foreground">
        {t(error ? "plans.progress.unavailable" : "plans.progress.noRun")}
      </p>
    );
  return (
    <div
      className="flex min-w-0 gap-1 overflow-x-auto px-3"
      aria-label={t("plans.progress.sequence")}
    >
      {preview.steps.map((step, index) => (
        <span
          key={step.id}
          title={step.name}
          className={cn(
            "flex h-7.5 w-11 shrink-0 items-center justify-center bg-plan-progress-waiting text-xs font-semibold text-foreground",
            CHEVRON_SHAPE,
          )}
        >
          {index + 1}
          <span className="sr-only"> · {step.name}</span>
        </span>
      ))}
      {preview.gaps.map((gap) => {
        const label = `${gap.name} · ${t(`plans.progress.gap.${gap.reason}`)}`;
        return (
          <span
            key={gap.id}
            title={label}
            className={cn(
              "flex h-7.5 w-11 shrink-0 items-center justify-center bg-warning-subtle text-xs font-bold text-warning",
              CHEVRON_SHAPE,
            )}
          >
            <span aria-hidden="true">!</span>
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </div>
  );
}
