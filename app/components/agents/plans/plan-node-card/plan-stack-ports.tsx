import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { PLAN_PORT } from "@/definition/AgentPlanBranching";
import { PLAN_STACK_PORT } from "@/definition/AgentPlanStack";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { planInTargetClass } from "../plan-flow-ports";
import { PLAN_CARD_ROW } from "./plan-card";

import type {
  AgentPlanStack,
  AgentPlanStackOutput,
} from "@/definition/AgentPlanStack";

const PORT_BUTTON =
  "nodrag nopan h-7 min-h-7 min-w-0 border-transparent bg-transparent px-1 text-xs leading-4.5 font-normal text-muted-foreground shadow-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring xl:min-h-7 xl:px-1 xl:text-xs";

/**
 * The trigger IN of a stack, a row of the input column: every trigger hands
 * the next entry to the flow OUT on the header.
 * @remarks
 * Several connections may end at IN. It is the stack's one flow input, so the
 * header has no flow IN dot of its own.
 */
export function PlanStackFlowRow(props: {
  readonly stack: AgentPlanStack;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { stack } = props;
  const hasIssue = graph.issues.some(
    (issue) => issue.nodeId === stack.id && issue.port === PLAN_PORT.flowIn,
  );
  return (
    <div className={PLAN_CARD_ROW}>
      <PlanFlowHandle
        id={PLAN_PORT.flowIn}
        type="target"
        kind="flow"
        hasIssue={hasIssue}
        title={t("plans.stack.inLabel")}
      />
      <Button
        size="sm"
        variant="outline"
        data-plan-in={stack.id}
        aria-label={t("plans.stack.inLabel")}
        title={t("plans.stack.inLabel")}
        className={cn(
          PORT_BUTTON,
          "-ml-1 max-w-full justify-start",
          hasIssue && "text-destructive",
          planInTargetClass(graph, stack.id),
        )}
        disabled={!canEdit}
        onClick={() => graph.connect(stack.id)}
      >
        <span className="truncate">{t("plans.stack.in")}</span>
      </Button>
    </div>
  );
}

/**
 * One data output of a stack, right-aligned in the output column with its
 * port on the right edge; what it holds now stands in its tooltip.
 * @remarks
 * Reading an output never triggers the stack.
 */
export function PlanStackOutput(props: {
  readonly stack: AgentPlanStack;
  readonly output: AgentPlanStackOutput;
  /** What the output holds now, such as `3 · Zahl` or the entry handed over last. */
  readonly value: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { stack, output } = props;
  const port =
    output === "content"
      ? PLAN_STACK_PORT.contentOut
      : PLAN_STACK_PORT.countOut;
  const isActive =
    graph.connection?.kind === "stack" &&
    graph.connection.nodeId === stack.id &&
    graph.connection.output === output;
  return (
    <div
      data-plan-stack-output={output}
      className={cn(PLAN_CARD_ROW, "justify-end")}
    >
      <Button
        size="xs"
        variant="ghost"
        data-plan-out={stack.id}
        data-plan-out-kind={output}
        aria-label={t("plans.stack.outLabel", {
          output: t(`plans.stack.output.${output}`),
          name: stack.name,
        })}
        title={props.value}
        className={cn(
          PORT_BUTTON,
          "-mr-1 max-w-full cursor-crosshair justify-end",
          isActive && "text-primary",
        )}
        disabled={!canEdit}
        onClick={() => graph.begin({ kind: "stack", nodeId: stack.id, output })}
      >
        <span className="truncate">{t(`plans.stack.output.${output}`)}</span>
      </Button>
      <PlanFlowHandle id={port} type="source" kind="data" />
    </div>
  );
}
