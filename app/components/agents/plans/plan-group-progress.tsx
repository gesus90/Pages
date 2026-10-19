import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type {
  PlanGroupProgress,
  PlanGroupState,
} from "@/definition/AgentPlanGroupProgress";

const STATE_TONES: Record<PlanGroupState, string> = {
  ready: "text-muted-foreground",
  running: "text-status-active",
  pausing: "text-status-active",
  paused: "text-muted-foreground",
  stopping: "text-status-active",
  stopped: "text-muted-foreground",
  completed: "text-success",
  blocked: "text-destructive",
  failed: "text-destructive",
  unavailable: "text-destructive",
};

/** A readable status remains separate from the group's yellow type identity. */
export function PlanGroupStatus({
  progress,
  isCompact = false,
}: {
  readonly progress: PlanGroupProgress;
  readonly isCompact?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = t(`plans.groups.state.${progress.state}`);
  return (
    <span
      title={
        progress.error
          ? `${label} · ${t(`settings.agents.error.${progress.error}`)}`
          : label
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5",
        isCompact ? "text-[11px] leading-4" : "text-xs",
        STATE_TONES[progress.state],
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/** Small ring with an external count; unknown and empty totals never paint a full circle. */
export function PlanGroupCount({
  progress,
  isCompact,
}: {
  readonly progress: PlanGroupProgress;
  readonly isCompact: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { completed, total } = progress;
  const count = `${completed} / ${total ?? "—"}`;
  const fraction = total && total > 0 ? Math.min(1, completed / total) : 0;
  const label =
    total === null
      ? t("plans.progress.unknownTotal")
      : t("plans.progress.count", { completed, total });
  return (
    <span
      className={cn(
        "flex shrink-0 items-center",
        isCompact ? "gap-1" : "gap-2",
      )}
      role="img"
      aria-label={label}
    >
      {isCompact ? (
        <svg
          viewBox="0 0 28 28"
          className="size-6 -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="14"
            cy="14"
            r="11"
            fill="none"
            stroke="var(--color-plan-progress-waiting)"
            strokeWidth="3"
          />
          {fraction > 0 ? (
            <circle
              cx="14"
              cy="14"
              r="11"
              fill="none"
              stroke="var(--color-plan-progress-done)"
              strokeWidth="3"
              pathLength="100"
              strokeDasharray={`${fraction * 100} 100`}
              strokeLinecap="round"
            />
          ) : null}
        </svg>
      ) : null}
      <span
        aria-hidden="true"
        className={cn(
          "tabular-nums",
          isCompact ? "text-xs" : "min-w-20 text-sm font-semibold",
        )}
      >
        <span className="block">{count}</span>
        {!isCompact ? (
          <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
            {t("plans.progress.completed")}
          </span>
        ) : null}
      </span>
    </span>
  );
}
