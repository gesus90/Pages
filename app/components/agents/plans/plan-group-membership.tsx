import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { AgentPlanInput, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanGraphActions } from "./use-plan-graph";

/**
 * Moves an agent node into a group or out of every frame without a pointer.
 *
 * @remarks
 * It applies the same membership rules as dragging: a group of another ACP
 * class refuses the node and tells why, and the node is left unchanged.
 */
export function PlanGroupMembership(props: {
  readonly step: AgentPlanStep;
  readonly group: AgentPlanGroup | null;
  readonly draft: AgentPlanInput;
  readonly graph: PlanGraphActions;
  readonly disabled: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const groups = props.draft.nodes.filter((node) => node.type === "group");
  if (groups.length === 0) return null;
  return (
    <div className="space-y-1 text-sm">
      <span>{t("plans.groups.membership")}</span>
      <Select
        ariaLabel={t("plans.groups.membership")}
        value={props.group?.id ?? ""}
        disabled={props.disabled}
        options={[
          { value: "", label: t("plans.groups.noGroup") },
          ...groups.map((group) => ({ value: group.id, label: group.name })),
        ]}
        onValueChange={(groupId) =>
          props.graph.assign(props.step.id, groupId || null)
        }
      />
    </div>
  );
}
