import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  PLAN_LOOP_RUNS_BINDING,
  PLAN_LOOP_WHILE_BINDING,
  planLoopMode,
} from "@/definition/AgentPlanLoop";

import { PlanFlowHandle } from "./plan-flow-handle";
import { planInTargetClass } from "./plan-flow-ports";
import { PLAN_LOOP_PORT_ROW, planNodeLabel } from "./plan-layout";
import { PLAN_LOOP_INPUT_TOP } from "./plan-loop-ports";
import { PLAN_NODE_TEXT } from "./plan-node-text";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { PlanGraphActions } from "./use-plan-graph";

const LEFT_EDGE = {
  top: PLAN_LOOP_INPUT_TOP,
  left: 0,
  right: "auto",
  transform: "translate(-50%, -50%)",
} as const;

/** The name of what a loop input reads: a parameter, or the count output of a stack. */
function sourceName(
  binding: AgentPlanBinding | undefined,
  context: {
    readonly draft: AgentPlanInput;
    readonly sources: AgentPlanSources;
  },
  countLabel: string,
): string | null {
  if (binding?.kind === "stack") {
    const stack = context.draft.nodes.find(
      (node) => node.id === binding.stackId,
    );
    return stack
      ? `${planNodeLabel(stack, context.sources)} · ${countLabel}`
      : null;
  }
  if (binding?.kind !== "source") return null;
  const node = context.draft.nodes.find((entry) => entry.id === binding.nodeId);
  return node ? planNodeLabel(node, context.sources) : null;
}

/**
 * The labelled port rows of a loop container: In and Out, then the Count or While input.
 *
 * @remarks
 * Inputs sit on the left edge and the exit on the right, like on every card.
 * The data input takes a parameter or the count output of a stack for the
 * count, or a boolean parameter for a while loop; a line drawn to it binds it.
 */
export function PlanLoopPortRows(props: {
  readonly loop: AgentPlanLoop;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { loop, graph } = props;
  const isWhile = planLoopMode(loop) === "while";
  const input = isWhile ? PLAN_LOOP_WHILE_BINDING : PLAN_LOOP_RUNS_BINDING;
  const bound = sourceName(
    loop.bindings[input],
    props,
    t("plans.stack.output.count"),
  );
  const hasIssue = graph.issues.some(
    (issue) => issue.nodeId === loop.id && issue.port === input,
  );
  const inputText = inputLabel({ loop, isWhile, bound, t });
  return (
    <div
      className={cn("pointer-events-auto px-5", PLAN_NODE_TEXT.meta)}
      data-plan-loop-ports={loop.id}
    >
      <div
        className="flex items-center justify-between gap-4 font-medium text-foreground"
        style={{ height: PLAN_LOOP_PORT_ROW }}
      >
        <span>{t("plans.flowInShort")}</span>
        <span>{t("plans.loops.outAfter")}</span>
      </div>
      <div className="flex items-center" style={{ height: PLAN_LOOP_PORT_ROW }}>
        <button
          type="button"
          data-plan-in={loop.id}
          data-plan-port={input}
          aria-label={t("plans.loops.inputLabel", {
            input: inputText,
            name: loop.name,
          })}
          className={cn(
            "nodrag nopan -ml-1 max-w-full truncate rounded-md border border-dashed border-plan-parameter/50 px-1.5 py-0.5 text-left text-plan-parameter disabled:cursor-default",
            hasIssue && "border-destructive text-destructive",
            planInTargetClass(graph, loop.id, input),
          )}
          disabled={!props.canEdit}
          onClick={() => graph.connect(loop.id, input)}
        >
          {inputText}
        </button>
      </div>
      <PlanFlowHandle
        id={`input:${input}`}
        type="target"
        kind="data"
        hasIssue={hasIssue}
        style={LEFT_EDGE}
      />
    </div>
  );
}

function inputLabel(context: {
  readonly loop: AgentPlanLoop;
  readonly isWhile: boolean;
  readonly bound: string | null;
  readonly t: (key: string, options?: Record<string, unknown>) => string;
}): string {
  const { loop, isWhile, bound, t } = context;
  if (isWhile)
    return bound
      ? t("plans.loops.input.whileBound", { name: bound })
      : t("plans.loops.input.whileOpen");
  if (loop.runsSource === "value")
    return t("plans.loops.input.countFixed", { count: loop.runs });
  return bound
    ? t("plans.loops.input.countBound", { name: bound })
    : t("plans.loops.input.countOpen");
}
