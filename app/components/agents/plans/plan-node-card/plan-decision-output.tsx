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

/** The colour of each output; the word always says which output it is. */
function outputTone(branch: AgentPlanBranch): string {
  if (branch === "true") return "text-success";
  return branch === "false" ? "text-warning" : "text-plan-logic";
}

/** What an output says: the situation of true and false, or the name of a value. */
function useOutputTexts(
  branch: AgentPlanBranch,
  caseName: string | undefined,
): { readonly when: string; readonly word: string } {
  const { t } = useTranslation();
  if (branch === "true" || branch === "false")
    return {
      when: t(`plans.decision.when.${branch}`),
      word: t(`plans.decision.branch.${branch}`),
    };
  const trimmed = caseName?.trim() ?? "";
  const name = trimmed === "" ? t("plans.decision.caseUnnamed") : trimmed;
  return { when: t("plans.decision.whenCase", { name }), word: name };
}

/**
 * One output of a decision: the situation that activates it, and its port.
 *
 * @remarks
 * `taken` is what the shown run recorded: the activated output is marked
 * with a check and the others lose their colour. Text is never faded, so an
 * output that was not taken stays as readable as the rest of the card. A
 * value of a classification is named by its current name; its port stays
 * `case:<id>`, so renaming keeps the connection.
 */
export function PlanDecisionOutput(props: {
  readonly decision: AgentPlanDecision;
  readonly branch: AgentPlanBranch;
  readonly label: string;
  readonly caseName?: string;
  readonly taken?: AgentPlanBranch;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { decision, branch } = props;
  const port = planBranchPort(branch);
  const texts = useOutputTexts(branch, props.caseName);
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
          hasIssue && "text-destructive",
        )}
        title={texts.when}
      >
        {texts.when}
      </span>
      <Button
        size="xs"
        variant="ghost"
        data-plan-out={decision.id}
        data-plan-out-kind={branch}
        aria-label={t("plans.decision.outLabel", {
          branch: texts.word,
          name: props.label,
        })}
        className={cn(
          "nodrag nopan -mr-1.25 h-7 min-h-7 max-w-[55%] shrink-0 cursor-crosshair gap-1 border border-transparent px-1 font-semibold hover:bg-surface/70 xl:min-h-7 xl:px-1 xl:text-xs",
          PLAN_NODE_TEXT.field,
          isMuted ? "text-muted-foreground" : outputTone(branch),
          isActive && "border-primary",
        )}
        disabled={!canEdit}
        onClick={() =>
          graph.begin({ kind: "branch", nodeId: decision.id, branch })
        }
      >
        {isTaken ? <Check aria-hidden="true" className="size-3" /> : null}
        <span className="truncate">{texts.word}</span>
      </Button>
      <PlanFlowHandle
        id={port}
        type="source"
        kind={branch === "true" || branch === "false" ? branch : "logic"}
        hasIssue={hasIssue}
      />
    </div>
  );
}
