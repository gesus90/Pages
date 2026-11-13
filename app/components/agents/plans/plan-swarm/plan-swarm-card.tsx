import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { planSwarmTaskCounts } from "@/definition/AgentPlanSwarmRun";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowPorts } from "../plan-flow-ports";
import { PlanCard } from "../plan-node-card/plan-card";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import {
  PlanStatusBadge,
  isQueuedPlanStep,
  planRunCardClass,
} from "../plan-status";
import { PlanSwarmBadges } from "./plan-swarm-badges";
import { planSwarmBadges } from "./plan-swarm-model";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";

/** The task of a swarm in one line: its text, or the bound ticket. */
function useTaskLine(swarm: AgentPlanSwarm): string {
  const { t } = useTranslation();
  if (swarm.task.source === "ticket") return t("plans.swarm.taskTicket");
  return swarm.task.text.trim() || t("plans.swarm.taskMissing");
}

/** Model and reasoning of the main model, or what it does now in a run. */
function useMainLine(
  swarm: AgentPlanSwarm,
  result: AgentPlanStepResult | undefined,
): string {
  const { t } = useTranslation();
  const activity =
    result?.status === "running" ? result.swarm?.main.activity : null;
  if (activity) return activity;
  const model = swarm.main.model;
  if (!model) return t("plans.swarm.modelMissing");
  return model.reasoningEffort
    ? `${model.model} · ${model.reasoningEffort}`
    : model.model;
}

/** The pill of a running swarm: finished of handed-out subtasks. */
function TaskPill(props: {
  readonly result: AgentPlanStepResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { result } = props;
  if (result?.status !== "running" || !result.swarm) return null;
  const counts = planSwarmTaskCounts(result.swarm);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-status-active/40 bg-status-active-subtle px-1.5 text-[11px] leading-4 font-semibold text-status-active tabular-nums"
      aria-label={t("plans.swarm.taskCount", counts)}
      data-plan-swarm-pill
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-3 motion-safe:animate-spin"
      />
      {`${String(counts.finished)}/${String(counts.assigned)}`}
    </span>
  );
}

/**
 * A swarm on the canvas: the card of an agent node with the swarm symbol,
 * the task in one line, the main model and the helpers as badges (PAGE-313).
 *
 * @remarks
 * While a run is shown the card takes the run status color like every node,
 * the main line shows what the main model does now, the badges show each
 * helper's status and a pill counts the finished subtasks.
 */
export function PlanSwarmCard(props: {
  readonly swarm: AgentPlanSwarm;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit, onEdit } = usePlanFlowContext();
  const { swarm, result } = props;
  const taskLine = useTaskLine(swarm);
  const mainLine = useMainLine(swarm, result);
  const title = swarm.name ?? t("plans.nodeType.swarm");
  const badges = planSwarmBadges(
    swarm,
    props.hasRun ? result?.swarm : undefined,
  );
  function edit(): void {
    graph.select(swarm.id);
    onEdit?.(swarm.id);
  }
  return (
    <PlanCard
      node={swarm}
      label={title}
      title={title}
      subtitle={t("plans.nodeType.swarm")}
      runClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={
        props.hasRun ? (
          <>
            <TaskPill result={result} />
            <PlanStatusBadge
              isQueued={isQueuedPlanStep(result)}
              compact
              status={result?.status ?? "waiting"}
              isBlocked={result?.isBlocked}
            />
          </>
        ) : null
      }
      onEdit={edit}
    >
      <div className="flex flex-col gap-1.5 px-3 pt-1 pb-3">
        <PlanFlowPorts node={swarm} graph={graph} canEdit={canEdit} isCompact />
        <p className={cn("truncate", PLAN_NODE_TEXT.field)} title={taskLine}>
          {taskLine}
        </p>
        <p className={cn("flex min-w-0 gap-2", PLAN_NODE_TEXT.field)}>
          <span className="shrink-0 font-semibold text-muted-foreground">
            {t("plans.swarm.mainShort")}
          </span>
          <span className="min-w-0 truncate" title={mainLine}>
            {mainLine}
          </span>
        </p>
        <PlanSwarmBadges badges={badges} />
      </div>
    </PlanCard>
  );
}
