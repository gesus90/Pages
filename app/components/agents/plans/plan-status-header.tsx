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
      className="flex max-w-32.5 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.75 text-xs leading-4.5 font-semibold"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
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
      className="flex shrink-0 items-center gap-1.75 border-l border-border pl-3"
      role="img"
      aria-label={steps.length ? label : t("plans.progress.unknownTotal")}
    >
      <svg viewBox="0 0 56 56" aria-hidden="true" className="size-6 -rotate-90">
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
      <span aria-hidden="true" className="min-w-0">
        <span className="block text-xs leading-4.5 font-medium tabular-nums">
          {steps.length ? `${completed}/${steps.length}` : "—"}
        </span>
        <span className="sr-only">{t("plans.progress.completed")}</span>
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
    <div className="flex min-h-11.5 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 @2xl/status:flex-nowrap">
      <RunIndicator run={props.run} error={props.error} />
      <RunDonut steps={props.steps} />
      <div className="order-last flex w-full min-w-0 border-border @2xl/status:order-0 @2xl/status:w-auto @2xl/status:flex-1 @2xl/status:border-l">
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
        className="ml-auto flex shrink-0 items-center gap-1.5 border-l border-border pl-3 text-xs leading-4.5 font-medium tabular-nums @2xl/status:ml-0"
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
