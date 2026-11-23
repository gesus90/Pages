import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  PLAN_GIT_CLOSEOUT_OUTPUT,
  PLAN_GIT_CLOSEOUT_PARAMETERS,
} from "@/definition/AgentPlanGitCloseout";

import { usePlanFlowContext } from "../plan-flow-context";
import { PLAN_TYPE_COLORS } from "../plan-layout";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PlanRunMarker, planRunCardClass } from "../plan-status";
import { PlanAgentInput } from "./plan-agent-input";
import { PlanCard, PlanCardColumns, PLAN_CARD_BODY } from "./plan-card";
import { PlanResultOut } from "./plan-result-out";
import { PlanRunNotes } from "./plan-run-notes";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanGitCloseout } from "@/definition/AgentPlanGitCloseout";

/**
 * A saved Git closeout of an earlier version, marked as no longer supported.
 * @remarks
 * The node keeps its flow dots, its ticket input and its result
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
  const { graph, onEdit } = usePlanFlowContext();
  const { closeout, result } = props;
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
      stateClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={<PlanRunMarker hasRun={props.hasRun} result={result} />}
      onEdit={edit}
    >
      <div className={PLAN_CARD_BODY}>
        <PlanRunNotes result={result} />
        <PlanCardColumns
          label={t("plans.inputsOf", { name: closeout.name })}
          inputs={PLAN_GIT_CLOSEOUT_PARAMETERS.map((parameter) => (
            <PlanAgentInput
              key={parameter.name}
              step={closeout}
              label={closeout.name}
              parameter={parameter}
            />
          ))}
          outputs={
            <PlanResultOut
              nodeId={closeout.id}
              output={PLAN_GIT_CLOSEOUT_OUTPUT}
            />
          }
        />
      </div>
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-t px-3.5",
          PLAN_TYPE_COLORS.line,
        )}
      >
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
