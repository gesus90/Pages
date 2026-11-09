import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { isPlanLoopLeftRegularly } from "@/definition/AgentPlanLoopRun";

import { planLoopProgress } from "./plan-loop-summary";
import { PLAN_NODE_TEXT } from "./plan-node-text";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";

const TONES = {
  waiting: "text-muted-foreground",
  running: "text-status-active",
  paused: "text-muted-foreground",
  succeeded: "text-success",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
  skipped: "text-muted-foreground",
} as const;

/** The text of the header state: before a start, a regular end with its reason, or the recorded state. */
function loopStatusKey(
  record: AgentPlanLoopRun | undefined,
  run: AgentPlanRun | null,
): string {
  const status = record?.status ?? "waiting";
  if (record?.completion && isPlanLoopLeftRegularly(record))
    return `plans.loops.completion.${record.completion}`;
  if (run === null || status === "waiting")
    return "plans.loops.status.notStarted";
  if (status === "succeeded") return "plans.loops.status.closing";
  return `plans.loops.status.${status}`;
}

/**
 * The run state of a loop's header: before a start, the iteration and its status, or how it ended.
 *
 * @remarks
 * The state, the reason a loop ended regularly and a failure stay separate:
 * a count that ran out is never shown as a met condition. Only a loop that
 * was left regularly with a confirmed cleanup shows success, with a check
 * mark beside its reason; any other `succeeded` record stays neutral.
 */
export function PlanLoopStatus(props: {
  readonly loop: AgentPlanLoop;
  readonly record: AgentPlanLoopRun | undefined;
  readonly run: AgentPlanRun | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { record } = props;
  const status = record?.status ?? "waiting";
  const isLeft = isPlanLoopLeftRegularly(record);
  const progress = planLoopProgress(record);
  const label = t(loopStatusKey(record, props.run));
  return (
    <span
      data-plan-loop-status={isLeft ? "left" : status}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5",
        PLAN_NODE_TEXT.meta,
        isLeft || status !== "succeeded" ? TONES[status] : TONES.waiting,
        isLeft && "font-semibold",
      )}
      title={record?.error ? t(`settings.agents.error.${record.error}`) : label}
    >
      {isLeft ? (
        <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      )}
      {progress && status !== "waiting" ? `${progress} · ${label}` : label}
    </span>
  );
}
