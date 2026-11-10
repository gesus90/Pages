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
 * A saved Git closeout of an earlier version, marked as no longer supported.
 *
 * @remarks
 * The node (PAGE-285) keeps its flow ports, its ticket input and its result
 * port, so its saved connections stay visible until someone removes it. In
 * place of the check command the card says what to do with it; the recorded
 * status of an earlier run stays readable.
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
  function edit(): void {
    graph.select(closeout.id);
    onEdit?.(closeout.id);
  }
  return (
    <PlanCard
      node={closeout}
      label={closeout.name}
      title={closeout.name}
      subtitle={t("plans.gitCloseout.legacySubtitle")}
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
            "min-w-0 truncate text-destructive",
            PLAN_NODE_TEXT.meta,
          )}
          title={t("plans.validation.gitCloseoutUnsupported")}
        >
          {t("plans.gitCloseout.legacyHint")}
        </span>
      </div>
    </PlanCard>
  );
}
