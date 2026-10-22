import { useTranslation } from "react-i18next";
import { Select } from "@/app/components/ui/select";
import type {
  AgentPlanExecutionTarget,
  AgentPlanRemoteTarget,
} from "@/definition/AgentPlanExecution";

/** Selects authorized metadata only; choosing a target never starts a runner. */
export function PlanExecutionTargetSelect(props: {
  readonly id: string;
  readonly target: AgentPlanExecutionTarget | undefined;
  readonly choices: readonly AgentPlanRemoteTarget[];
  readonly onChange: (target: AgentPlanExecutionTarget) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const remoteId =
    props.target?.kind === "remote" ? props.target.workspaceId : "";
  function change(workspaceId: string): void {
    props.onChange(
      workspaceId ? { kind: "remote", workspaceId } : { kind: "local" },
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <label htmlFor={props.id}>{t("plans.execution.target")}</label>
      <Select
        id={props.id}
        ariaLabel={t("plans.execution.target")}
        value={remoteId}
        options={[
          { value: "", label: t("plans.execution.local") },
          ...props.choices.map((choice) => ({
            value: choice.workspaceId,
            label: `${choice.workspaceName} · ${choice.connectionName}`,
            description: choice.path,
          })),
          ...(remoteId &&
          !props.choices.some((choice) => choice.workspaceId === remoteId)
            ? [
                {
                  value: remoteId,
                  label: t("plans.execution.unavailable"),
                  disabled: true,
                },
              ]
            : []),
        ]}
        onValueChange={change}
      />
      {remoteId ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("plans.execution.remoteHint")}
        </p>
      ) : null}
    </div>
  );
}
