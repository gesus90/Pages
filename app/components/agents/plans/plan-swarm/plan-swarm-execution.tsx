import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  PLAN_SWARM_TEXT_LENGTH,
  PLAN_SWARM_TIMEOUT_MINUTES,
  isPlanSwarmDirectory,
} from "@/definition/AgentPlanSwarm";

import { PanelField } from "../plan-panel-controls";
import { isPlanSwarmTargetRefused } from "./plan-swarm-form";
import { PlanSwarmHeading } from "./plan-swarm-sections";

import type { PlanSwarmSectionProps } from "./plan-swarm-sections";

const INHERIT = "";
const LOCAL = "local";

/** The target choice: as the plan, the Pages host, and the remote targets greyed out with the reason. */
function TargetSelect(props: PlanSwarmSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { swarm } = props;
  const reason = t("plans.swarm.remoteRefused");
  const target = swarm.executionTarget;
  const value =
    target?.kind === "remote" ? target.workspaceId : (target?.kind ?? INHERIT);
  return (
    <PanelField id={id} label={t("plans.execution.target")}>
      <Select
        id={id}
        size="sm"
        ariaLabel={t("plans.execution.target")}
        value={value}
        disabled={props.isDisabled}
        options={[
          { value: INHERIT, label: t("plans.swarm.targetInherit") },
          { value: LOCAL, label: t("plans.execution.local") },
          ...(props.sources.remoteTargets ?? []).map((choice) => ({
            value: choice.workspaceId,
            label: `${choice.workspaceName} · ${choice.connectionName}`,
            description: reason,
            disabled: true,
          })),
        ]}
        onValueChange={(next) => {
          props.onChange({
            ...swarm,
            executionTarget: next === LOCAL ? { kind: "local" } : undefined,
          });
        }}
      />
    </PanelField>
  );
}

/**
 * Ausführung: working directory, time limit and target of the whole node.
 *
 * @remarks
 * A swarm runs only on the Pages host. A remote target, chosen earlier or
 * inherited from the plan, shows the refusal in the error color; the save
 * refuses it with the same sentence, never silently.
 */
export function PlanSwarmExecutionSection(
  props: PlanSwarmSectionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const directoryId = useId();
  const timeoutId = useId();
  const { swarm } = props;
  const directory = swarm.directory ?? "";
  return (
    <section
      className="flex flex-col gap-2"
      data-plan-swarm-section="execution"
    >
      <PlanSwarmHeading>{t("plans.swarm.sections.execution")}</PlanSwarmHeading>
      <PanelField id={directoryId} label={t("plans.swarm.directory")}>
        <Input
          id={directoryId}
          size="sm"
          value={directory}
          placeholder="/"
          maxLength={PLAN_SWARM_TEXT_LENGTH.directory}
          aria-invalid={directory !== "" && !isPlanSwarmDirectory(directory)}
          disabled={props.isDisabled}
          onChange={(event) => {
            const next = event.target.value;
            props.onChange({ ...swarm, directory: next || undefined });
          }}
        />
      </PanelField>
      <PanelField id={timeoutId} label={t("plans.swarm.timeout")}>
        <div className="flex items-center gap-2">
          <Input
            id={timeoutId}
            size="sm"
            type="number"
            min={PLAN_SWARM_TIMEOUT_MINUTES.minimum}
            max={PLAN_SWARM_TIMEOUT_MINUTES.maximum}
            value={String(swarm.timeoutMinutes)}
            disabled={props.isDisabled}
            className="w-24"
            onChange={(event) => {
              const minutes = Number(event.target.value);
              if (Number.isInteger(minutes))
                props.onChange({ ...swarm, timeoutMinutes: minutes });
            }}
          />
          <span className="text-xs text-muted-foreground">
            {t("plans.swarm.minutes")}
          </span>
        </div>
      </PanelField>
      <TargetSelect {...props} />
      {isPlanSwarmTargetRefused(swarm, props.draft) ? (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-plan-swarm-remote
        >
          {t("plans.swarm.remoteRefused")}
        </p>
      ) : null}
    </section>
  );
}
