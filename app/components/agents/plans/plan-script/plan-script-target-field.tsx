import { useId } from "react";
import { useTranslation } from "react-i18next";

import { PlanExecutionTargetSelect } from "../plan-execution-target-select";

import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { PlanScriptForm } from "./use-plan-script-form";

/** Shows the selected script host and directory, including unavailable saved targets. */
export function PlanScriptTargetField(props: {
  readonly form: PlanScriptForm;
  readonly choices: readonly AgentPlanRemoteTarget[];
  readonly workspace:
    { readonly name: string; readonly path: string } | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const target = props.form.values.executionTarget;
  const remote =
    target.kind === "remote"
      ? props.choices.find(
          (choice) => choice.workspaceId === target.workspaceId,
        )
      : undefined;
  const workspace = target.kind === "local" ? props.workspace : undefined;
  const host =
    target.kind === "local"
      ? t("plans.execution.local")
      : (remote?.connectionName ?? t("plans.execution.unavailable"));
  return (
    <div className="space-y-3">
      <PlanExecutionTargetSelect
        id={id}
        target={target}
        choices={props.choices}
        onChange={(executionTarget) => props.form.change({ executionTarget })}
      />
      <div className="space-y-1 rounded-xl border border-border p-3 text-xs">
        <p className="font-semibold">{host}</p>
        <p>{remote?.workspaceName ?? workspace?.name}</p>
        <p className="wrap-anywhere text-muted-foreground">
          {remote?.path ?? workspace?.path}
        </p>
        {target.kind === "local" ? (
          <p className="text-muted-foreground">
            {t("plans.execution.scriptCheckHint")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
