import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { PLAN_PORT, planReceivesEvents } from "@/definition/AgentPlanBranching";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { planInTargetClass } from "../plan-flow-ports";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PLAN_CARD_ROW } from "./plan-card";

import type { AgentPlanStep } from "@/definition/AgentPlan";

/**
 * The optional event input of an agent: a result sent here starts the agent
 * again in its open session, with that result as the new prompt.
 * @remarks
 * The row is always there in the input column, so that the connection can
 * be made from either side; its caption is the tooltip of the name.
 */
export function PlanAgentEventIn(props: {
  readonly step: AgentPlanStep;
  /** The name of the agent for the accessible name of the port. */
  readonly label: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { step } = props;
  const hasIssue = graph.issues.some(
    (issue) => issue.nodeId === step.id && issue.port === PLAN_PORT.eventIn,
  );
  return (
    <div data-plan-event-in={step.id} className={PLAN_CARD_ROW}>
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
          "nodrag nopan -ml-1 flex h-7 min-w-0 items-center rounded-md border border-transparent px-1 text-left text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default",
          PLAN_NODE_TEXT.field,
          hasIssue && "text-destructive",
          planInTargetClass(graph, step.id, PLAN_PORT.eventIn),
        )}
        aria-label={t("plans.event.inLabel", { name: props.label })}
        title={t("plans.event.caption")}
        disabled={!canEdit}
        onClick={() => graph.connect(step.id, PLAN_PORT.eventIn)}
      >
        <span className="truncate">{t("plans.event.in")}</span>
      </button>
    </div>
  );
}

/** The chip below the rows of an agent whose event input is connected: what an event does. */
export function PlanAgentEventChip(props: {
  readonly step: AgentPlanStep;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { draft } = usePlanFlowContext();
  if (!planReceivesEvents(draft, props.step.id)) return null;
  return (
    <p
      data-plan-event-chip=""
      className={cn(
        "truncate rounded-md border border-dashed border-info/60 bg-info-subtle px-2 py-1 text-info",
        PLAN_NODE_TEXT.field,
      )}
    >
      {t("plans.event.resume")}
    </p>
  );
}

/**
 * The boolean result of an agent: `true` when its closing report showed every
 * todo done and every criterion met, `false` otherwise.
 * @remarks
 * A decision reads it. It is a result of its own beside the text result in
 * the output column; its button names the type, its tooltip the result.
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
      className={cn(PLAN_CARD_ROW, "justify-end")}
    >
      <Button
        size="xs"
        variant="ghost"
        data-plan-out={step.id}
        data-plan-out-kind="passed"
        aria-label={t("plans.passed.outLabel", { name: props.label })}
        title={t("plans.passed.label")}
        className={cn(
          "nodrag nopan -mr-1 h-7 min-h-7 min-w-0 cursor-crosshair border border-transparent px-1 font-medium text-plan-logic hover:bg-muted xl:min-h-7 xl:px-1 xl:text-xs",
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
