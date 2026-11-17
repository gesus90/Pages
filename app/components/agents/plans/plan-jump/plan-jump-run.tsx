import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { cn } from "@/app/lib/cn";
import { isPlanInvocationFinal } from "@/definition/AgentPlanJump";

import { PLAN_NODE_TEXT } from "../plan-node-text";
import { planJumpRemaining } from "./plan-jump-text";

import type {
  AgentPlanRun,
  AgentPlanStepStatus,
} from "@/definition/AgentPlan";
import type {
  AgentPlanJumpRun,
  AgentPlanRunInvocation,
} from "@/definition/AgentPlanJump";

/** What the run says about an outgoing Jump at this moment. */
export type PlanJumpPhase =
  | "waiting"
  | "handedOver"
  | "signalWaiting"
  | "resultPaused"
  | "timeoutPaused"
  | "decided";

/** What a run view needs to say where an outgoing Jump stands. */
interface PlanJumpPhaseInput {
  readonly jump: AgentPlanJumpRun;
  readonly stepStatus: AgentPlanStepStatus;
  readonly runStatus: AgentPlanRun["status"] | undefined;
}

/**
 * Where an outgoing Jump stands, as one phase of the run.
 * @remarks
 * A paused run keeps a Jump that was already decided waiting for the
 * continuation; the words say so instead of showing a wait that is over.
 * While the workspace is handed over, a received signal waits for it to come
 * back.
 */
export function planJumpPhase(input: PlanJumpPhaseInput): PlanJumpPhase {
  const { jump, stepStatus, runStatus } = input;
  const isDecided = isPlanInvocationFinal(jump.state);
  const isRunning = stepStatus === "running";
  if (isDecided && isRunning && runStatus === "paused")
    return jump.state === "timed_out" ? "timeoutPaused" : "resultPaused";
  if (jump.handover === "handed_over")
    return jump.hasSignal && isRunning ? "signalWaiting" : "handedOver";
  return isDecided ? "decided" : "waiting";
}

/** The current time in milliseconds, renewed every half minute while it is wanted. */
function useNow(isWanted: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!isWanted) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [isWanted]);
  return now;
}

/** The address of a run of a plan on the plan page. */
function runAddress(planId: string, runId: string): string {
  return `/agents/plans?planId=${encodeURIComponent(planId)}&runId=${encodeURIComponent(runId)}`;
}

const LINK_CLASS =
  "nodrag nopan inline-flex min-h-6 max-w-full items-center gap-1 rounded-sm font-medium text-foreground underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** The words of the phase; a wait names the plan it waits for and how long is left. */
function usePhaseText(input: PlanJumpPhaseInput): {
  readonly phase: PlanJumpPhase;
  readonly text: string;
} {
  const { t } = useTranslation();
  const phase = planJumpPhase(input);
  const now = useNow(phase === "waiting" && input.jump.deadlineAt !== null);
  const { jump } = input;
  if (phase === "waiting") {
    const duration =
      now === null && jump.deadlineAt !== null
        ? null
        : planJumpRemaining(jump.deadlineAt, now ?? 0, t);
    return {
      phase,
      text:
        duration === null
          ? t("plans.jump.run.waitingShort", { plan: jump.targetPlanName })
          : t("plans.jump.run.waiting", {
              plan: jump.targetPlanName,
              duration,
            }),
    };
  }
  if (phase === "decided")
    return { phase, text: t(`plans.jump.run.state.${jump.state}`) };
  return { phase, text: t(`plans.jump.run.phase.${phase}`) };
}

/** The status of the run the call started, in words: queued, no run yet, or the status of the run. */
function TargetStatus(props: {
  readonly status: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p
      data-plan-jump-target-status={props.status}
      className={cn("text-muted-foreground", PLAN_NODE_TEXT.meta)}
    >
      {t("plans.jump.run.targetStatus", {
        status: t(`plans.jump.targetStatus.${props.status}`, {
          defaultValue: props.status,
        }),
      })}
    </p>
  );
}

/** The link from the calling Jump to the run it started; it only appears when the ids are present. */
function TargetRunLink(props: {
  readonly jump: AgentPlanJumpRun;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { targetPlanId, targetRunId } = props.jump;
  if (!targetPlanId || !targetRunId) return null;
  return (
    <Link
      to={runAddress(targetPlanId, targetRunId)}
      data-plan-jump-link="target"
      className={cn(LINK_CLASS, PLAN_NODE_TEXT.meta)}
    >
      <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">
        {t("plans.jump.run.openTarget", { plan: props.jump.targetPlanName })}
      </span>
    </Link>
  );
}

/** The safe failure code of a call that did not succeed, in the words the interface has for it. */
function ReasonLine(props: {
  readonly reason: string | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!props.reason) return null;
  return (
    <p className={cn("text-destructive", PLAN_NODE_TEXT.meta)}>
      {t("plans.jump.run.reason", {
        reason: t(`settings.agents.error.${props.reason}`, {
          defaultValue: t("plans.jump.run.reasonUnknown"),
        }),
      })}
    </p>
  );
}

/**
 * Where an outgoing Jump stands in the shown run: the phase, the status of the called run and the link to it.
 * @remarks
 * The ids of the called run are present only when the reader may read it; no
 * link appears without them.
 */
export function PlanJumpRunLines(
  props: PlanJumpPhaseInput,
): React.ReactElement {
  const { jump } = props;
  const { phase, text } = usePhaseText(props);
  return (
    <div data-plan-jump-run="" className="flex flex-col gap-0.5">
      <p
        data-plan-jump-phase={phase}
        className={cn("font-medium text-foreground", PLAN_NODE_TEXT.meta)}
      >
        {text}
      </p>
      <TargetStatus status={jump.targetStatus} />
      <ReasonLine reason={jump.reason} />
      <TargetRunLink jump={jump} />
    </div>
  );
}

/**
 * The note on a run that a call started, with the link back to the calling run.
 * @remarks
 * The ids of the calling run are present only when the reader may read it;
 * without them the note says that a call started the run and links nowhere.
 */
export function PlanInvocationNote(props: {
  readonly invocation: AgentPlanRunInvocation | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { invocation } = props;
  if (!invocation) return null;
  const canLink = Boolean(invocation.sourcePlanId && invocation.sourceRunId);
  return (
    <p
      data-plan-invocation=""
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2 text-xs text-foreground"
    >
      <span>{t("plans.jump.run.calledBy")}</span>
      {canLink ? (
        <Link
          to={runAddress(invocation.sourcePlanId, invocation.sourceRunId)}
          data-plan-jump-link="source"
          className={cn(LINK_CLASS, "text-xs")}
        >
          <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
          {t("plans.jump.run.openSource")}
        </Link>
      ) : null}
    </p>
  );
}
