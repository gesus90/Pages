import {
  Ban,
  CheckCircle2,
  Circle,
  CirclePause,
  CircleX,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentPlanStepStatus } from "@/definition/AgentPlan";

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
): string {
  if (isBlocked)
    return "border-destructive/40 bg-destructive-subtle text-destructive";
  return STATUS_CLASSES[status];
}

/** Supplements color with a distinct icon; motion respects reduced-motion preferences. */
function PlanStatusIcon({
  status,
  isBlocked,
}: {
  readonly status: AgentPlanStepStatus;
  readonly isBlocked: boolean;
}): React.ReactElement {
  const statusIcon = {
    waiting: Circle,
    running: LoaderCircle,
    succeeded: CheckCircle2,
    failed: CircleX,
    cancelled: Ban,
    paused: CirclePause,
  }[status];
  const Icon = isBlocked ? LockKeyhole : statusIcon;
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
  compact = false,
  isConcise = false,
  className,
}: {
  readonly status: AgentPlanStepStatus;
  readonly isBlocked?: boolean;
  readonly compact?: boolean;
  readonly isConcise?: boolean;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = t(isBlocked ? "plans.blocked" : `plans.status.${status}`);
  const visibleLabel = isBlocked && isConcise ? t("plans.blockedShort") : label;
  return (
    <span
      title={label}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
        planStatusClass(status, isBlocked),
        className,
      )}
    >
      <PlanStatusIcon status={status} isBlocked={isBlocked} />
      <span className={compact ? "sr-only" : undefined}>{visibleLabel}</span>
    </span>
  );
}
