import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { isSamePlanTarget } from "@/definition/AgentPlanTarget";

import type { TFunction } from "i18next";
import type {
  AgentPlanExecutionTarget,
  AgentPlanRemoteTarget,
} from "@/definition/AgentPlanExecution";

/** The value of the explicit Pages host; remote workspaces use their identifier. */
const LOCAL_VALUE = "local";

/** Names a target as the selection shows it. */
export function planTargetLabel(
  target: AgentPlanExecutionTarget | undefined,
  choices: readonly AgentPlanRemoteTarget[],
  translate: TFunction,
): string {
  if (target?.kind !== "remote") return translate("plans.execution.local");
  const choice = choices.find(
    (entry) => entry.workspaceId === target.workspaceId,
  );
  return choice
    ? `${choice.workspaceName} · ${choice.connectionName}`
    : translate("plans.execution.unavailable");
}

function selectedValue(target: AgentPlanExecutionTarget | undefined): string {
  if (!target) return "";
  return target.kind === "remote" ? target.workspaceId : LOCAL_VALUE;
}

/**
 * Selects where one node runs: as the plan says, or deliberately elsewhere.
 *
 * @remarks
 * Only authorized metadata is offered and choosing a target never starts a
 * runner. A node that keeps "as the plan" follows later changes of the plan
 * target; a node with its own target is a visible deviation.
 */
export function PlanExecutionTargetSelect(props: {
  readonly id: string;
  readonly target: AgentPlanExecutionTarget | undefined;
  /** The plan's target, which a node without its own target inherits. */
  readonly planTarget: AgentPlanExecutionTarget | undefined;
  readonly choices: readonly AgentPlanRemoteTarget[];
  readonly onChange: (target: AgentPlanExecutionTarget | undefined) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const value = selectedValue(props.target);
  const isDeviation =
    props.target !== undefined &&
    !isSamePlanTarget(props.target, props.planTarget);
  function change(next: string): void {
    if (next === "") props.onChange(undefined);
    else if (next === LOCAL_VALUE) props.onChange({ kind: "local" });
    else props.onChange({ kind: "remote", workspaceId: next });
  }
  const isRemote =
    (props.target ?? props.planTarget)?.kind === "remote" ||
    (value !== "" && value !== LOCAL_VALUE);
  return (
    <div className="space-y-2 text-sm">
      <label htmlFor={props.id}>{t("plans.execution.target")}</label>
      <Select
        id={props.id}
        ariaLabel={t("plans.execution.target")}
        value={value}
        options={[
          {
            value: "",
            label: t("plans.execution.inherit", {
              target: planTargetLabel(props.planTarget, props.choices, t),
            }),
          },
          { value: LOCAL_VALUE, label: t("plans.execution.local") },
          ...props.choices.map((choice) => ({
            value: choice.workspaceId,
            label: `${choice.workspaceName} · ${choice.connectionName}`,
            description: choice.path,
          })),
          ...(value !== "" &&
          value !== LOCAL_VALUE &&
          !props.choices.some((choice) => choice.workspaceId === value)
            ? [
                {
                  value,
                  label: t("plans.execution.unavailable"),
                  disabled: true,
                },
              ]
            : []),
        ]}
        onValueChange={change}
      />
      {isDeviation ? (
        <p className="text-xs font-semibold text-status-active">
          {t("plans.execution.deviation")}
        </p>
      ) : null}
      {isRemote ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("plans.execution.remoteHint")}
        </p>
      ) : null}
    </div>
  );
}
