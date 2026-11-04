import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  PLAN_GIT_CLOSEOUT_OUTPUT,
  PLAN_GIT_CLOSEOUT_PARAMETERS,
} from "@/definition/AgentPlanGitCloseout";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowPorts } from "../plan-flow-ports";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import {
  hasOpenPlanReport,
  PlanStatusBadge,
  isQueuedPlanStep,
  planRunCardClass,
} from "../plan-status";
import { PlanAgentInput } from "./plan-agent-input";
import { PlanCard } from "./plan-card";
import { PlanResultOut } from "./plan-result-out";
import { PlanRunNotes } from "./plan-run-notes";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanGitCloseout } from "@/definition/AgentPlanGitCloseout";

/**
 * The Git closeout with its flow IN and OUT, its ticket and its result.
 *
 * @remarks
 * It has the width and the type color of a script, because it runs in the same
 * process boundary. In place of a model the card shows the check command, or
 * says that it is missing.
 */
export function PlanGitCloseoutCard(props: {
  readonly closeout: AgentPlanGitCloseout;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit, onEdit } = usePlanFlowContext();
  const { closeout, result } = props;
  const status = result?.status ?? "waiting";
  const command = closeout.checkCommand.trim();
  function edit(): void {
    graph.select(closeout.id);
    onEdit?.(closeout.id);
  }
  return (
    <PlanCard
      node={closeout}
      label={closeout.name}
      title={closeout.name}
      subtitle={t("plans.nodeType.git_closeout")}
      runClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={
        props.hasRun ? (
          <PlanStatusBadge
            isQueued={isQueuedPlanStep(result)}
            compact
            status={status}
            isBlocked={result?.isBlocked}
            hasOpenReport={hasOpenPlanReport(result)}
          />
        ) : null
      }
      onEdit={edit}
    >
      <div className="flex flex-col gap-1.5 px-3 pt-1 pb-2">
        <PlanRunNotes result={result} />
        <PlanFlowPorts
          node={closeout}
          graph={graph}
          canEdit={canEdit}
          isCompact
        />
        <div
          role="group"
          aria-label={t("plans.inputsOf", { name: closeout.name })}
          className="flex flex-col gap-1.5"
        >
          {PLAN_GIT_CLOSEOUT_PARAMETERS.map((parameter) => (
            <PlanAgentInput
              key={parameter.name}
              step={closeout}
              label={closeout.name}
              parameter={parameter}
            />
          ))}
        </div>
        <PlanResultOut nodeId={closeout.id} output={PLAN_GIT_CLOSEOUT_OUTPUT} />
      </div>
      <div className="flex h-12 shrink-0 items-center border-t border-border px-3">
        <span
          className={cn(
            "min-w-0 truncate",
            PLAN_NODE_TEXT.meta,
            command ? "font-mono text-muted-foreground" : "text-destructive",
          )}
          title={command || undefined}
        >
          {command || t("plans.gitCloseout.checkCommandMissing")}
        </span>
      </div>
    </PlanCard>
  );
}
