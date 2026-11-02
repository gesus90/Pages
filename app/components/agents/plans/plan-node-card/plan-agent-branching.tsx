import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { PLAN_PORT, planReceivesEvents } from "@/definition/AgentPlanBranching";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { planInTargetClass } from "../plan-flow-ports";
import { PLAN_NODE_TEXT } from "../plan-node-text";

import type { AgentPlanStep } from "@/definition/AgentPlan";

/**
 * The optional event input of an agent: a result sent here starts the agent
 * again in its open session, with that result as the new prompt.
 *
 * @remarks
 * The row is always there, so that the connection can be made from either
 * side. Once an event is connected, a chip names what happens.
 */
export function PlanAgentEventIn(props: {
  readonly step: AgentPlanStep;
  /** The name of the agent for the accessible name of the port. */
  readonly label: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft, graph, canEdit } = usePlanFlowContext();
  const { step } = props;
  const hasIssue = graph.issues.some(
    (issue) => issue.nodeId === step.id && issue.port === PLAN_PORT.eventIn,
  );
  return (
    <div data-plan-event-in={step.id} className="flex flex-col gap-1.5">
      <div className="relative flex h-7 items-center justify-between gap-2">
        <PlanFlowHandle
          id={PLAN_PORT.eventIn}
          type="target"
          kind="event"
          hasIssue={hasIssue}
        />
        <button
          type="button"
          data-plan-in={step.id}
          data-plan-port={PLAN_PORT.eventIn}
          className={cn(
            "nodrag nopan -ml-1.25 flex h-7 min-w-0 shrink-0 items-center rounded-md border border-transparent px-1 text-left font-medium hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default",
            PLAN_NODE_TEXT.field,
            hasIssue && "text-destructive",
            planInTargetClass(graph, step.id, PLAN_PORT.eventIn),
          )}
          aria-label={t("plans.event.inLabel", { name: props.label })}
          disabled={!canEdit}
          onClick={() => graph.connect(step.id, PLAN_PORT.eventIn)}
        >
          {t("plans.event.in")}
        </button>
        <span
          className={cn(
            "min-w-0 truncate text-muted-foreground",
            PLAN_NODE_TEXT.meta,
          )}
        >
          {t("plans.event.caption")}
        </span>
      </div>
      {planReceivesEvents(draft, step.id) ? (
        <p
          data-plan-event-chip=""
          className={cn(
            "truncate rounded-md border border-dashed border-info/60 bg-info-subtle px-2 py-1 text-info",
            PLAN_NODE_TEXT.field,
          )}
        >
          {t("plans.event.resume")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The boolean result of an agent: `true` when its closing report showed every
 * todo done and every criterion met, `false` otherwise.
 *
 * @remarks
 * A decision reads it. It is a result of its own beside the text result, so
 * its row and its port are named for what they carry.
 */
export function PlanAgentPassedOut(props: {
  readonly step: AgentPlanStep;
  /** The name of the agent for the accessible name of the port. */
  readonly label: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { step } = props;
  const isActive =
    graph.connection?.nodeId === step.id && graph.connection.kind === "passed";
  return (
    <div
      data-plan-passed-out={step.id}
      className="relative flex h-7 items-center justify-between gap-2"
    >
      <span className={cn("shrink-0 font-medium", PLAN_NODE_TEXT.field)}>
        {t("plans.passed.label")}
      </span>
      <Button
        size="xs"
        variant="ghost"
        data-plan-out={step.id}
        data-plan-out-kind="passed"
        aria-label={t("plans.passed.outLabel", { name: props.label })}
        className={cn(
          "nodrag nopan -mr-1.25 h-7 min-h-7 min-w-0 cursor-crosshair border border-transparent px-1 font-medium text-plan-logic hover:bg-surface/70 xl:min-h-7 xl:px-1 xl:text-xs",
          PLAN_NODE_TEXT.meta,
          isActive && "border-plan-logic-edge",
        )}
        disabled={!canEdit}
        onClick={() => graph.begin({ kind: "passed", nodeId: step.id })}
      >
        <span className="truncate">{t("plans.passed.caption")}</span>
      </Button>
      <PlanFlowHandle id={PLAN_PORT.passedOut} type="source" kind="logic" />
    </div>
  );
}
