import { useId } from "react";
import { useTranslation } from "react-i18next";

import { scriptLocalPaths } from "@/definition/AgentPlanTarget";

import { PlanExecutionTargetSelect } from "../plan-execution-target-select";

import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { PlanScriptForm } from "./use-plan-script-form";

/**
 * Shows where the script runs: host and directory, including unavailable saved targets.
 *
 * @remarks
 * A script for a remote target that names absolute paths of the Pages host
 * is pointed out; Pages never rewrites them and never calls the script
 * remote-ready.
 */
export function PlanScriptTargetField(props: {
  readonly form: PlanScriptForm;
  readonly choices: readonly AgentPlanRemoteTarget[];
  readonly workspace:
    { readonly name: string; readonly path: string } | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const target = props.form.effectiveTarget;
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
  const localPaths =
    target.kind === "remote"
      ? scriptLocalPaths({ content: props.form.values.content })
      : [];
  return (
    <div className="space-y-3">
      <PlanExecutionTargetSelect
        id={id}
        target={props.form.values.executionTarget}
        planTarget={props.form.planTarget}
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
      {localPaths.length > 0 ? (
        <p
          role="note"
          className="rounded-lg bg-warning-subtle px-3 py-2 text-xs text-warning"
        >
          {t("plans.execution.localPaths", { paths: localPaths.join(", ") })}
        </p>
      ) : null}
    </div>
  );
}
