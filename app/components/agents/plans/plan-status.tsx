import { CheckCircle2, Circle, CircleX, LoaderCircle } from "lucide-react";
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

/** A single status palette shared by the grid, sequence and progress list. */
export function planStatusClass(status: AgentPlanStepStatus): string {
  return STATUS_CLASSES[status];
}

/** Supplements color with a distinct icon; motion respects reduced-motion preferences. */
function PlanStatusIcon({
  status,
}: {
  readonly status: AgentPlanStepStatus;
}): React.ReactElement {
  const Icon = {
    waiting: Circle,
    running: LoaderCircle,
    succeeded: CheckCircle2,
    failed: CircleX,
    cancelled: Circle,
    paused: Circle,
  }[status];
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        status === "running" && "motion-safe:animate-spin",
      )}
    />
  );
}

/** Names waiting, paused, cancelled and blocked states rather than relying on color alone. */
export function PlanStatusBadge({
  status,
  isBlocked = false,
  compact = false,
}: {
  readonly status: AgentPlanStepStatus;
  readonly isBlocked?: boolean;
  readonly compact?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = t(isBlocked ? "plans.blocked" : `plans.status.${status}`);
  return (
    <span
      title={label}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
        planStatusClass(status),
      )}
    >
      <PlanStatusIcon status={status} />
      <span className={compact ? "sr-only" : undefined}>{label}</span>
    </span>
  );
}
