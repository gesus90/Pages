import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { planSwarmTaskCounts } from "@/definition/AgentPlanSwarmRun";

import { usePlanFlowContext } from "../plan-flow-context";
import {
  PlanCard,
  PlanCardColumns,
  PLAN_CARD_BODY,
} from "../plan-node-card/plan-card";
import { PLAN_TYPE_COLORS } from "../plan-layout";
import { PlanNodeIcon } from "../plan-node-icon";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PlanRunMarker, planRunCardClass } from "../plan-status";
import { PlanSwarmBadges } from "./plan-swarm-badges";
import { planSwarmBadges } from "./plan-swarm-model";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";
import type { PlanSwarmBadge } from "./plan-swarm-model";

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

/** The line below the footer fields of a shown run: finished of handed-out subtasks. */
function TaskCountLine(props: {
  readonly result: AgentPlanStepResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { result } = props;
  if (!result?.swarm) return null;
  return (
    <p
      data-plan-swarm-count=""
      className={cn(
        "truncate text-center text-muted-foreground tabular-nums",
        PLAN_NODE_TEXT.meta,
      )}
    >
      {t("plans.swarm.taskCount", planSwarmTaskCounts(result.swarm))}
    </p>
  );
}

/** The task of the swarm as the one input row of its body. */
function TaskRow(props: { readonly taskLine: string }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="grid h-8 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-1">
      <span
        className={cn("truncate text-muted-foreground", PLAN_NODE_TEXT.field)}
      >
        {t("plans.swarm.sections.task")}
      </span>
      <span
        title={props.taskLine}
        className={cn(
          "flex h-6 max-w-[6.5rem] min-w-0 items-center truncate rounded-sm px-2",
          PLAN_TYPE_COLORS.field,
          PLAN_NODE_TEXT.field,
        )}
      >
        <span className="truncate">{props.taskLine}</span>
      </span>
    </div>
  );
}

/**
 * The footer of a swarm: the main model in a wide field, one 58 px field
 * per helper beside it, and the count of finished subtasks below them.
 */
function SwarmFooter(props: {
  readonly mainLine: string;
  readonly badges: readonly PlanSwarmBadge[];
  readonly result: AgentPlanStepResult | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <footer
      className={cn(
        "flex shrink-0 flex-col gap-1.5 border-t p-3",
        PLAN_TYPE_COLORS.line,
      )}
    >
      <div className="flex flex-wrap gap-2">
        <p
          className="flex h-10 min-w-[7.5rem] flex-1 basis-[7.5rem] items-center gap-1.5 rounded-lg border border-plan-swarm/40 bg-surface pr-2 pl-[5px] text-xs leading-4 font-semibold"
          title={props.mainLine}
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-plan-swarm-subtle text-plan-swarm"
          >
            <PlanNodeIcon type="swarm" className="size-4" />
          </span>
          <span className="min-w-0 truncate">
            {`${t("plans.swarm.mainShort")} · ${props.mainLine}`}
          </span>
        </p>
        <PlanSwarmBadges badges={props.badges} />
      </div>
      <TaskCountLine result={props.result} />
    </footer>
  );
}

/**
 * A swarm on the canvas: the card of an agent node with the swarm symbol,
 * its task as input row and the main model and the helpers in the footer.
 *
 * @remarks
 * While a run is shown the status marker names the run status, the main
 * field shows what the main model does now, the helper fields show each
 * helper's status and the line below counts the finished subtasks.
 */
export function PlanSwarmCard(props: {
  readonly swarm: AgentPlanSwarm;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, onEdit } = usePlanFlowContext();
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
      stateClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={<PlanRunMarker hasRun={props.hasRun} result={result} />}
      onEdit={edit}
    >
      <div className={PLAN_CARD_BODY}>
        <PlanCardColumns
          inputs={<TaskRow taskLine={taskLine} />}
          outputs={null}
        />
      </div>
      <SwarmFooter
        mainLine={mainLine}
        badges={badges}
        result={props.hasRun ? result : undefined}
      />
    </PlanCard>
  );
}
