import {
  Ban,
  CheckCircle2,
  Circle,
  CirclePause,
  CircleX,
  LoaderCircle,
  LockKeyhole,
  SkipForward,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { hasOpenPlanStepReport } from "@/definition/AgentPlanStackOutcome";

import type {
  AgentPlanStepResult,
  AgentPlanStepStatus,
} from "@/definition/AgentPlan";

const STATUS_CLASSES: Record<AgentPlanStepStatus, string> = {
  waiting: "border-muted-foreground/30 bg-muted text-muted-foreground",
  running: "border-status-active/40 bg-status-active-subtle text-status-active",
  succeeded: "border-success/40 bg-success-subtle text-success",
  failed: "border-destructive/40 bg-destructive-subtle text-destructive",
  cancelled: "border-muted-foreground/30 bg-muted text-muted-foreground",
  paused: "border-muted-foreground/30 bg-muted text-muted-foreground",
  skipped: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

/**
 * The shape of a status marker on a node card: 22 px high, a 6 px corner, a
 * 1 px edge, 8 px inset and 11 px semibold text.
 */
export const PLAN_STATUS_MARKER =
  "h-[22px] max-w-40 rounded-md px-2 text-[11px] leading-4 font-semibold whitespace-nowrap";

/** A blocked indicator overrides waiting without changing the recorded base status. */
export function planStatusClass(
  status: AgentPlanStepStatus,
  isBlocked = false,
  hasOpenReport = false,
): string {
  if (isBlocked)
    return "border-destructive/40 bg-destructive-subtle text-destructive";
  if (status === "succeeded" && hasOpenReport)
    return "border-warning/40 bg-warning-subtle text-warning";
  return STATUS_CLASSES[status];
}

/**
 * The state class of a card while a run is shown.
 * @remarks
 * Surface, edge and header keep the type color in every status; the status
 * marker alone carries the status color. A node on a branch a decision did
 * not activate keeps its dashed edge: it never ran, and nothing waits for it.
 */
export function planRunCardClass(
  result: AgentPlanStepResult | undefined,
): string {
  return result?.status === "skipped" ? "border-dashed" : "";
}

/** A process can complete while its recorded business report stays open. */
export function hasOpenPlanReport(
  step: AgentPlanStepResult | undefined,
): boolean {
  return hasOpenPlanStepReport(step);
}

/** Only a waiting successor is blocked by a predecessor; a failed node names its own block. */
export function planStatusKey(
  status: AgentPlanStepStatus,
  isBlocked = false,
  hasOpenReport = false,
): string {
  if (isBlocked)
    return status === "waiting" ? "plans.blocked" : "plans.blockedShort";
  if (status === "succeeded" && hasOpenReport) return "plans.reportOpen";
  return `plans.status.${status}`;
}

/** Supplements color with a distinct icon; motion respects reduced-motion preferences. */
function PlanStatusIcon({
  status,
  isBlocked,
  hasOpenReport,
}: {
  readonly status: AgentPlanStepStatus;
  readonly isBlocked: boolean;
  readonly hasOpenReport: boolean;
}): React.ReactElement {
  const statusIcon = {
    waiting: Circle,
    running: LoaderCircle,
    succeeded: CheckCircle2,
    failed: CircleX,
    cancelled: Ban,
    paused: CirclePause,
    skipped: SkipForward,
  }[status];
  let Icon = statusIcon;
  if (status === "succeeded" && hasOpenReport) Icon = TriangleAlert;
  if (isBlocked) Icon = LockKeyhole;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        status === "running" && !isBlocked && "motion-safe:animate-spin",
      )}
    />
  );
}

/** The shown status, its full label and its label for a concise badge. */
function usePlanStatusText(props: {
  readonly status: AgentPlanStepStatus;
  readonly isBlocked: boolean;
  readonly hasOpenReport: boolean;
  readonly isConcise: boolean;
  readonly isQueued: boolean;
}): {
  readonly label: string;
  readonly visibleLabel: string;
  readonly visibleStatus: AgentPlanStepStatus;
} {
  const { t } = useTranslation();
  const { status, isBlocked, hasOpenReport } = props;
  const isQueuedRun = props.isQueued && status === "running";
  const label = t(
    isQueuedRun
      ? "plans.status.queued"
      : planStatusKey(status, isBlocked, hasOpenReport),
  );
  return {
    label,
    visibleLabel:
      isBlocked && props.isConcise ? t("plans.blockedShort") : label,
    visibleStatus: isQueuedRun ? "waiting" : status,
  };
}

/** Names waiting, paused, cancelled and blocked states rather than relying on color alone. */
export function PlanStatusBadge({
  status,
  isBlocked = false,
  hasOpenReport = false,
  compact = false,
  isConcise = false,
  isMarker = false,
  className,
  isQueued = false,
}: {
  readonly isQueued?: boolean;
  /** The status marker of a node card: its label alone, 22 px high in 11 px semibold. */
  readonly isMarker?: boolean;
  readonly status: AgentPlanStepStatus;
  readonly isBlocked?: boolean;
  readonly hasOpenReport?: boolean;
  readonly compact?: boolean;
  readonly isConcise?: boolean;
  readonly className?: string;
}): React.ReactElement {
  const { label, visibleLabel, visibleStatus } = usePlanStatusText({
    status,
    isBlocked,
    hasOpenReport,
    isConcise,
    isQueued,
  });
  return (
    <span
      title={label}
      data-plan-status-marker={isMarker ? visibleStatus : undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center border",
        isMarker
          ? PLAN_STATUS_MARKER
          : "gap-1.5 rounded-full px-2 py-0.5 text-xs",
        planStatusClass(visibleStatus, isBlocked, hasOpenReport),
        className,
      )}
    >
      {isMarker ? null : (
        <PlanStatusIcon
          status={visibleStatus}
          isBlocked={isBlocked}
          hasOpenReport={hasOpenReport}
        />
      )}
      <span className={compact && !isMarker ? "sr-only" : "truncate"}>
        {visibleLabel}
      </span>
    </span>
  );
}

/** A dispatched remote claim is queued until the Runner proves a running launch. */
export function isQueuedPlanStep(
  step: AgentPlanStepResult | undefined,
): boolean {
  return (
    step?.status === "running" &&
    Boolean(step.execution?.target.kind === "remote") &&
    (!step.remote || ["queued", "accepted"].includes(step.remote.status))
  );
}

/**
 * The status marker of a node that runs, with its queued, blocked and open
 * report states; nothing while no run is shown.
 */
export function PlanRunMarker(props: {
  readonly hasRun: boolean;
  readonly result: AgentPlanStepResult | undefined;
}): React.ReactElement | null {
  const { result } = props;
  if (!props.hasRun) return null;
  return (
    <PlanStatusBadge
      isMarker
      isConcise
      isQueued={isQueuedPlanStep(result)}
      status={result?.status ?? "waiting"}
      isBlocked={result?.isBlocked}
      hasOpenReport={hasOpenPlanReport(result)}
    />
  );
}
