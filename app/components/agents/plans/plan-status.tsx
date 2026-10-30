import {
  Ban,
  CheckCircle2,
  Circle,
  CirclePause,
  CircleX,
  LoaderCircle,
  LockKeyhole,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

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
};

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

/** A process can complete while its recorded business report stays open. */
export function hasOpenPlanReport(
  step: AgentPlanStepResult | undefined,
): boolean {
  const verdict = step?.session?.acceptance?.verdict;
  return (
    step?.status === "succeeded" &&
    (verdict === "open" ||
      verdict === "rejected" ||
      (step.report !== undefined && step.report.status !== "passed"))
  );
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

/** Names waiting, paused, cancelled and blocked states rather than relying on color alone. */
export function PlanStatusBadge({
  status,
  isBlocked = false,
  hasOpenReport = false,
  compact = false,
  isConcise = false,
  className,
  isQueued = false,
}: {
  readonly isQueued?: boolean;
  readonly status: AgentPlanStepStatus;
  readonly isBlocked?: boolean;
  readonly hasOpenReport?: boolean;
  readonly compact?: boolean;
  readonly isConcise?: boolean;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const visibleStatus = isQueued && status === "running" ? "waiting" : status;
  const label = t(
    isQueued && status === "running"
      ? "plans.status.queued"
      : planStatusKey(status, isBlocked, hasOpenReport),
  );
  const visibleLabel = isBlocked && isConcise ? t("plans.blockedShort") : label;
  return (
    <span
      title={label}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
        planStatusClass(visibleStatus, isBlocked, hasOpenReport),
        className,
      )}
    >
      <PlanStatusIcon
        status={visibleStatus}
        isBlocked={isBlocked}
        hasOpenReport={hasOpenReport}
      />
      <span className={compact ? "sr-only" : undefined}>{visibleLabel}</span>
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
