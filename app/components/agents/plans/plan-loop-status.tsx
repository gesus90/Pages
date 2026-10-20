import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

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
} as const;

/**
 * The run state of a loop's header: before a start, the iteration and its status, or how it ended.
 *
 * @remarks
 * The state, the reason a loop ended regularly and a failure stay separate:
 * a count that ran out is never shown as a met condition.
 */
export function PlanLoopStatus(props: {
  readonly loop: AgentPlanLoop;
  readonly record: AgentPlanLoopRun | undefined;
  readonly run: AgentPlanRun | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { record } = props;
  const status = record?.status ?? "waiting";
  const progress = planLoopProgress(record);
  const label = record?.completion
    ? t(`plans.loops.completion.${record.completion}`)
    : t(
        props.run === null || status === "waiting"
          ? "plans.loops.status.notStarted"
          : `plans.loops.status.${status}`,
      );
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5",
        PLAN_NODE_TEXT.meta,
        TONES[status],
      )}
      title={record?.error ? t(`settings.agents.error.${record.error}`) : label}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {progress && status !== "waiting" ? `${progress} · ${label}` : label}
    </span>
  );
}
