import { useTranslation } from "react-i18next";

import { PlanExecutionTargetSelect } from "./plan-execution-target-select";

import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanSources, AgentPlanStep } from "@/definition/AgentPlan";

/** Chooses a registered execution target independently of the node's model access. */
export function PlanExecutionTargetField(props: {
  readonly step: AgentPlanStep;
  /** The plan's target, which the node inherits without one of its own. */
  readonly planTarget: AgentPlanExecutionTarget | undefined;
  readonly sources: AgentPlanSources;
  readonly configuration: AgentPlanConfiguration;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function change(target: AgentPlanExecutionTarget | undefined): void {
    props.onChange({ ...props.step, executionTarget: target });
  }
  const model = props.sources.models?.find(
    (entry) =>
      entry.connectionId === props.configuration.connectionId &&
      entry.model === props.configuration.model,
  );
  return (
    <div className="space-y-4 text-sm">
      <PlanExecutionTargetSelect
        id={`plan-target-${props.step.id}`}
        target={props.step.executionTarget}
        planTarget={props.planTarget}
        choices={props.sources.remoteTargets ?? []}
        onChange={change}
      />
      <p className="space-y-1">
        <span className="block">{t("plans.execution.modelAccess")}</span>
        <span className="block rounded-xl border border-border px-3 py-2 text-xs">
          {model?.connectionName ??
            props.configuration.connectionId ??
            t("plans.execution.unavailable")}
        </span>
      </p>
    </div>
  );
}
