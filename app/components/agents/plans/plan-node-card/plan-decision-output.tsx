import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { planBranchPort } from "@/definition/AgentPlanBranching";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { PLAN_NODE_TEXT } from "../plan-node-text";

import type { AgentPlanBranch } from "@/definition/AgentPlanBranching";
import type { AgentPlanDecision } from "@/definition/AgentPlan";

/** The word and the colour of each output; the word always says which branch it is. */
const OUTPUT_TONES = {
  true: "text-success",
  false: "text-warning",
} as const;

/**
 * One output of a decision: the situation that activates it, and its port.
 *
 * @remarks
 * `taken` is what the shown run recorded: the activated output is marked
 * with a check and the other one loses its colour. Text is never faded, so
 * the output that was not taken stays as readable as the rest of the card.
 */
export function PlanDecisionOutput(props: {
  readonly decision: AgentPlanDecision;
  readonly branch: AgentPlanBranch;
  readonly label: string;
  readonly taken?: AgentPlanBranch;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { decision, branch } = props;
  const port = planBranchPort(branch);
  const isTaken = props.taken === branch;
  const isMuted = props.taken !== undefined && !isTaken;
  const isActive =
    graph.connection?.nodeId === decision.id &&
    graph.connection.kind === "branch" &&
    graph.connection.branch === branch;
  const hasIssue = graph.issues.some(
    (issue) => issue.nodeId === decision.id && issue.port === port,
  );
  return (
    <div
      data-plan-branch={branch}
      data-plan-taken={isTaken ? "true" : undefined}
      data-plan-muted={isMuted ? "true" : undefined}
      className="relative flex h-8 items-center justify-between gap-2"
    >
      <span
        className={cn(
          "min-w-0 truncate text-muted-foreground",
          PLAN_NODE_TEXT.field,
          isTaken && "font-medium text-foreground",
        )}
        title={t(`plans.decision.when.${branch}`)}
      >
        {t(`plans.decision.when.${branch}`)}
      </span>
      <Button
        size="xs"
        variant="ghost"
        data-plan-out={decision.id}
        data-plan-out-kind={branch}
        aria-label={t("plans.decision.outLabel", {
          branch: t(`plans.decision.branch.${branch}`),
          name: props.label,
        })}
        className={cn(
          "nodrag nopan -mr-1.25 h-7 min-h-7 shrink-0 cursor-crosshair gap-1 border border-transparent px-1 font-semibold hover:bg-surface/70 xl:min-h-7 xl:px-1 xl:text-xs",
          PLAN_NODE_TEXT.field,
          isMuted ? "text-muted-foreground" : OUTPUT_TONES[branch],
          isActive && "border-primary",
        )}
        disabled={!canEdit}
        onClick={() =>
          graph.begin({ kind: "branch", nodeId: decision.id, branch })
        }
      >
        {isTaken ? <Check aria-hidden="true" className="size-3" /> : null}
        {t(`plans.decision.branch.${branch}`)}
      </Button>
      <PlanFlowHandle
        id={port}
        type="source"
        kind={branch}
        hasIssue={hasIssue}
      />
    </div>
  );
}
