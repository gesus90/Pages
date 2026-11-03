import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { PLAN_PORT } from "@/definition/AgentPlanBranching";
import { PLAN_STACK_PORT } from "@/definition/AgentPlanStack";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { planInTargetClass } from "../plan-flow-ports";
import { PLAN_NODE_TEXT } from "../plan-node-text";

import type {
  AgentPlanStack,
  AgentPlanStackOutput,
} from "@/definition/AgentPlanStack";

const PORT_BUTTON =
  "nodrag nopan h-7 min-h-7 border-transparent bg-transparent px-1 text-xs leading-4.5 font-medium shadow-none hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring xl:min-h-7 xl:px-1 xl:text-xs";

/**
 * The flow row of a stack: the trigger IN on the left, the flow OUT on the right.
 *
 * @remarks
 * Every trigger at IN hands the next entry to OUT; several connections may
 * end at IN. The ports keep the flow colour of every other card.
 */
export function PlanStackFlowRow(props: {
  readonly stack: AgentPlanStack;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { stack } = props;
  function hasIssue(port: string): boolean {
    return graph.issues.some(
      (issue) => issue.nodeId === stack.id && issue.port === port,
    );
  }
  return (
    <div className="relative flex h-8 items-center justify-between gap-2">
      <Button
        size="sm"
        variant="outline"
        data-plan-in={stack.id}
        aria-label={t("plans.stack.inLabel")}
        className={cn(
          PORT_BUTTON,
          "-ml-1.25",
          hasIssue(PLAN_PORT.flowIn) && "text-destructive",
          planInTargetClass(graph, stack.id),
        )}
        disabled={!canEdit}
        onClick={() => graph.connect(stack.id)}
      >
        {t("plans.stack.in")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        data-plan-out={stack.id}
        data-plan-out-kind="flow"
        aria-label={t("plans.flowOut")}
        className={cn(
          PORT_BUTTON,
          "-mr-1.25 cursor-crosshair",
          hasIssue(PLAN_PORT.flowOut) && "text-destructive",
          graph.connection?.nodeId === stack.id &&
            graph.connection.kind === "flow" &&
            "border-primary text-primary",
        )}
        disabled={!canEdit}
        onClick={() => graph.begin({ kind: "flow", nodeId: stack.id })}
      >
        {t("plans.flowOutShort")}
      </Button>
      <PlanFlowHandle
        id={PLAN_PORT.flowIn}
        type="target"
        kind="flow"
        hasIssue={hasIssue(PLAN_PORT.flowIn)}
      />
      <PlanFlowHandle
        id={PLAN_PORT.flowOut}
        type="source"
        kind="flow"
        hasIssue={hasIssue(PLAN_PORT.flowOut)}
      />
    </div>
  );
}

/**
 * One data output of a stack: its name, what it holds now, and its port on the right edge.
 *
 * @remarks
 * Reading an output never triggers the stack. The data ports keep the
 * colour and the dashed line of every other binding.
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
      className="relative flex h-8 items-center justify-between gap-2"
    >
      <span className={cn("shrink-0 text-foreground", PLAN_NODE_TEXT.field)}>
        {t(`plans.stack.output.${output}`)}
      </span>
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
          "nodrag nopan -mr-1.25 h-6 min-h-6 max-w-44 min-w-0 cursor-crosshair justify-end truncate rounded-md border border-dashed border-plan-parameter/60 bg-plan-parameter-subtle px-2 font-medium text-plan-parameter xl:min-h-6",
          PLAN_NODE_TEXT.meta,
          isActive && "border-solid border-primary text-primary",
        )}
        disabled={!canEdit}
        onClick={() => graph.begin({ kind: "stack", nodeId: stack.id, output })}
      >
        <span className="truncate">{props.value}</span>
      </Button>
      <PlanFlowHandle id={port} type="source" kind="data" />
    </div>
  );
}
