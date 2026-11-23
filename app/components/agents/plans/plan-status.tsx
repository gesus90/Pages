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
 * The status colors a whole card or container takes while a run shows it:
 * the status color S and its subtle surface SS.
 */
export type PlanStatusTone = "active" | "success" | "destructive" | "warning";

const STATUS_TONES: Record<AgentPlanStepStatus, PlanStatusTone | null> = {
  waiting: null,
  running: "active",
  succeeded: "success",
  failed: "destructive",
  cancelled: null,
  paused: null,
  skipped: null,
};

const TONE_COLORS: Record<PlanStatusTone, string> = {
  active:
    "[--plan-tone:var(--color-status-active)] [--plan-tone-subtle:var(--color-status-active-subtle)]",
  success:
    "[--plan-tone:var(--color-success)] [--plan-tone-subtle:var(--color-success-subtle)]",
  destructive:
    "[--plan-tone:var(--color-destructive)] [--plan-tone-subtle:var(--color-destructive-subtle)]",
  warning:
    "[--plan-tone:var(--color-warning)] [--plan-tone-subtle:var(--color-warning-subtle)]",
};

// The parts mixed from S and SS: edge 55 % S over the border, header 16 % S
// over SS with a line of 35 % S, a container surface of 70 % SS over the
// surface, value fields and marks 12 % S over the surface and dividers 28 % S.
// The name takes S with a fifth of the text color, which lifts it to 4.5:1 on
// the header in both palettes, where S alone reaches only 3.7:1 in light.
const TONE_PARTS =
  "[--plan-tone-text:color-mix(in_srgb,var(--plan-tone)_80%,var(--color-foreground))] [--plan-edge:color-mix(in_srgb,var(--plan-tone)_55%,var(--color-border))] [--plan-head:color-mix(in_srgb,var(--plan-tone)_16%,var(--plan-tone-subtle))] [--plan-head-line:color-mix(in_srgb,var(--plan-tone)_35%,transparent)] [--plan-frame-surface:color-mix(in_srgb,var(--plan-tone-subtle)_70%,var(--color-surface))] [--plan-field:color-mix(in_srgb,var(--plan-tone)_12%,var(--color-surface))] [--plan-line:color-mix(in_srgb,var(--plan-tone)_28%,transparent)]";

/**
 * The tone of a status for the whole card: running, done and failed take
 * their status color, blocked and an open report warn, while the marker of a
 * blocked card stays red; waiting, paused, cancelled and skipped keep the
 * type color.
 * @param status - The recorded status.
 * @param isBlocked - Whether a predecessor blocks the node.
 * @param hasOpenReport - Whether the business report of a done node stays open.
 * @returns The tone, or `null` while the card keeps its type color.
 */
export function planStatusTone(
  status: AgentPlanStepStatus,
  isBlocked = false,
  hasOpenReport = false,
): PlanStatusTone | null {
  if (status === "failed") return "destructive";
  if (isBlocked) return "warning";
  if (status === "succeeded" && hasOpenReport) return "warning";
  return STATUS_TONES[status];
}

/**
 * The CSS variables that draw a card or a container in a status tone.
 * @remarks
 * They set `--plan-tone`, `--plan-tone-subtle` and the parts mixed from them,
 * which the type colors of `PLAN_TYPE_COLORS` read before their type
 * fallback; without a tone the element keeps its type color. Only theme
 * tokens are named, so both palettes follow.
 * @param tone - The tone, or `null` for none.
 */
export function planToneClass(tone: PlanStatusTone | null): string {
  return tone ? cn(TONE_COLORS[tone], TONE_PARTS) : "";
}

/**
 * The shape of a status marker on a node card: 22 px high, a 6 px corner, a
 * 1 px edge, 8 px inset and 11 px semibold text.
 */
export const PLAN_STATUS_MARKER =
  "h-[22px] max-w-40 rounded-sm px-2 text-[11px] leading-4 font-semibold whitespace-nowrap";

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
 * A card that runs, is done or failed, is blocked or has an open report takes
 * the status tone of {@link planStatusTone} on its surface, edge, header,
 * tile, title, value fields and dividers; its status marker keeps its own
 * colors and names the status in text. A queued remote run still waits.
 * Waiting, paused and cancelled cards keep the type color. A node on a
 * branch a decision did not activate keeps its dashed edge: it never ran,
 * and nothing waits for it.
 */
export function planRunCardClass(
  result: AgentPlanStepResult | undefined,
): string {
  if (!result) return "";
  if (result.status === "skipped") return "border-dashed";
  const status = isQueuedPlanStep(result) ? "waiting" : result.status;
  return planToneClass(
    planStatusTone(status, result.isBlocked, hasOpenPlanReport(result)),
  );
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
