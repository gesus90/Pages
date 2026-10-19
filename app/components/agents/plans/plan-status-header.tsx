import { ChevronDown, ChevronUp, Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanPaletteButton } from "./plan-palette-button";
import { PlanStatusSequence } from "./plan-status-sequence";
import { elapsedTime } from "./plan-run-status-model";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

interface StatusHeaderProps {
  readonly run: AgentPlanRun | null;
  readonly steps: readonly AgentPlanStepResult[];
  readonly end: string | null;
  readonly anchorId: string | null;
  readonly selectedId: string | null;
  readonly isOpen: boolean;
  readonly contentId: string;
  readonly error: string | null;
  readonly onSelect: (id: string) => void;
  readonly onToggle: () => void;
}

function RunIndicator({
  run,
  error,
}: Pick<StatusHeaderProps, "run" | "error">): React.ReactElement {
  const { t } = useTranslation();
  const isBlocked =
    run?.status === "running" &&
    run.steps.some((step) => step.isBlocked) &&
    !run.steps.some((step) => step.status === "running");
  const status = isBlocked ? "blocked" : (run?.status ?? "idle");
  const isFailure =
    status === "failed" || status === "blocked" || Boolean(error);
  const label = error
    ? t("plans.progress.unavailable")
    : t(`plans.progress.state.${status}`);
  return (
    <span
      title={label}
      className="flex max-w-28 min-w-0 shrink-0 @3xl:min-w-22 @3xl:max-w-44 items-center gap-2 rounded-lg border border-border/70 px-2 py-2 text-xs font-semibold @3xl:gap-3 @3xl:px-3 @3xl:py-2.5 @3xl:text-base"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2.5 shrink-0 rounded-full @3xl:size-3",
          isFailure ? "bg-destructive" : "bg-primary",
          status === "succeeded" && "bg-plan-progress-done",
          (status === "idle" ||
            status === "cancelled" ||
            status === "paused") &&
            "bg-muted-foreground",
        )}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

function RunDonut({
  steps,
}: Pick<StatusHeaderProps, "steps">): React.ReactElement {
  const { t } = useTranslation();
  const completed = steps.filter((step) => step.status === "succeeded").length;
  const label = t("plans.progress.count", { completed, total: steps.length });
  const fraction = steps.length ? completed / steps.length : 0;
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-l border-muted-foreground/55 pl-3 @3xl:gap-3 @3xl:pl-4"
      role="img"
      aria-label={steps.length ? label : t("plans.progress.unknownTotal")}
    >
      <svg
        viewBox="0 0 56 56"
        aria-hidden="true"
        className="size-9 -rotate-90 @3xl:size-15"
      >
        <circle
          cx="28"
          cy="28"
          r="24"
          fill="none"
          stroke="var(--color-plan-progress-waiting)"
          strokeWidth="7"
        />
        {fraction > 0 ? (
          <circle
            cx="28"
            cy="28"
            r="24"
            fill="none"
            stroke="var(--color-plan-progress-done)"
            strokeWidth="7"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${fraction * 100} 100`}
          />
        ) : null}
      </svg>
      <span aria-hidden="true" className="min-w-10 @3xl:min-w-20">
        <span className="block text-base font-medium tabular-nums @3xl:text-xl">
          {steps.length ? `${completed}/${steps.length}` : "—"}
        </span>
        <span className="hidden text-xs text-muted-foreground @3xl:block">
          {t("plans.progress.completed")}
        </span>
      </span>
    </div>
  );
}

/** The unchanged compact head of the floating status panel. */
export function PlanStatusHeader(props: StatusHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  const toggle = t(
    props.isOpen ? "plans.progress.close" : "plans.progress.open",
  );
  const duration = elapsedTime(props.run?.startedAt, props.end);
  return (
    <div className="flex min-h-20 shrink-0 flex-wrap items-center gap-2 px-3 py-3 @3xl:min-h-26 @3xl:flex-nowrap @3xl:gap-5 @3xl:px-5 @3xl:py-4">
      <RunIndicator run={props.run} error={props.error} />
      <RunDonut steps={props.steps} />
      <div className="order-last flex w-full min-w-0 border-muted-foreground/55 @3xl:order-0 @3xl:w-auto @3xl:flex-1 @3xl:border-l">
        {props.run && props.steps.length ? (
          <PlanStatusSequence
            run={props.run}
            steps={props.steps}
            anchorId={props.anchorId}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
          />
        ) : (
          <p className="px-3 text-xs text-muted-foreground">
            {t(
              props.error
                ? "plans.progress.unavailable"
                : "plans.progress.noRun",
            )}
          </p>
        )}
      </div>
      <span
        title={t("plans.progress.elapsed")}
        aria-label={`${t("plans.progress.elapsed")}: ${duration}`}
        className="ml-auto flex shrink-0 items-center gap-2 border-l border-muted-foreground/55 pl-3 text-base font-medium tabular-nums @3xl:ml-0 @3xl:gap-3 @3xl:pl-5 @3xl:text-xl"
      >
        <Clock3 aria-hidden="true" className="size-5 @3xl:size-7" />
        {duration}
      </span>
      <div className="shrink-0 border-l border-muted-foreground/55 pl-3 @3xl:pl-5">
        <PlanPaletteButton
          variant="outline"
          size="icon"
          tooltip={toggle}
          aria-label={toggle}
          aria-expanded={props.isOpen}
          aria-controls={props.contentId}
          onClick={props.onToggle}
          className="size-9 rounded-xl bg-surface-hover/80 @3xl:h-14 @3xl:w-14"
        >
          {props.isOpen ? (
            <ChevronDown aria-hidden="true" className="size-6" />
          ) : (
            <ChevronUp aria-hidden="true" className="size-6" />
          )}
        </PlanPaletteButton>
      </div>
    </div>
  );
}
