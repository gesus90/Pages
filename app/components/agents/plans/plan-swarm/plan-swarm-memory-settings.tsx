import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import {
  PLAN_SWARM_MEMORY_MIN_WORKERS,
  planSwarmMemorySetting,
} from "@/definition/AgentPlanSwarmMemory";

import { PanelSwitch } from "../plan-panel-controls";
import { PlanSwarmHeading } from "./plan-swarm-sections";

import type { AgentPlanSwarmMemorySetting } from "@/definition/AgentPlanSwarmMemory";
import type { PlanSwarmSectionProps } from "./plan-swarm-sections";

/** One indented option below the memory switch. */
function MemoryOption(props: {
  readonly label: string;
  readonly isChecked: boolean;
  readonly isDisabled: boolean;
  readonly name: string;
  readonly onChange: (isChecked: boolean) => void;
}): React.ReactElement {
  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    props.onChange(event.target.checked);
  }
  return (
    <label
      className="flex items-center gap-2 pl-4 text-xs"
      data-plan-swarm-memory-option={props.name}
    >
      <Checkbox
        checked={props.isChecked}
        disabled={props.isDisabled}
        onChange={handleChange}
      />
      <span className={props.isDisabled ? "text-muted-foreground" : undefined}>
        {props.label}
      </span>
    </label>
  );
}

/**
 * Gedächtnis: whether the helpers of the node share a versioned memory.
 * @remarks
 * Without a stored setting the memory is on from two helpers and off with
 * one. With one helper the two options below are locked, and they are also
 * locked while the memory is off. The subtitle names the cost: more context
 * per turn costs tokens.
 */
export function PlanSwarmMemorySection(
  props: PlanSwarmSectionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { swarm } = props;
  const setting = planSwarmMemorySetting(swarm);
  const hasSeveral = swarm.workers.count >= PLAN_SWARM_MEMORY_MIN_WORKERS;
  const areOptionsLocked = props.isDisabled || !hasSeveral || !setting.enabled;
  function change(next: Partial<AgentPlanSwarmMemorySetting>): void {
    props.onChange({ ...swarm, memory: { ...setting, ...next } });
  }
  return (
    <section className="flex flex-col gap-2" data-plan-swarm-section="memory">
      <PlanSwarmHeading>{t("plans.swarm.sections.memory")}</PlanSwarmHeading>
      <PanelSwitch
        label={t("plans.swarm.memorySetting.enabled")}
        description={t("plans.swarm.memorySetting.cost")}
        isChecked={setting.enabled}
        isDisabled={props.isDisabled}
        onChange={(isChecked) => change({ enabled: isChecked })}
      />
      <MemoryOption
        name="workersPublish"
        label={t("plans.swarm.memorySetting.workersPublish")}
        isChecked={setting.workersPublish}
        isDisabled={areOptionsLocked}
        onChange={(isChecked) => change({ workersPublish: isChecked })}
      />
      <MemoryOption
        name="keepAfterEnd"
        label={t("plans.swarm.memorySetting.keepAfterEnd")}
        isChecked={setting.keepAfterEnd}
        isDisabled={areOptionsLocked}
        onChange={(isChecked) => change({ keepAfterEnd: isChecked })}
      />
      {hasSeveral ? null : (
        <p className="text-xs text-muted-foreground">
          {t("plans.swarm.memorySetting.singleWorker")}
        </p>
      )}
    </section>
  );
}
