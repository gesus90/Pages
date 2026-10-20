import { useTranslation } from "react-i18next";

import { PlanFloatingPanel } from "./plan-floating-panel";
import { PlanGroupEditor } from "./plan-group-editor";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanGraphActions } from "./use-plan-graph";

/**
 * The floating settings panel of a session group, the same shell as the loop's.
 *
 * @remarks
 * It shows the group's existing settings only: name, the ACP class its members
 * decide, its members and the agents that may join. A group has no runs and
 * no end condition.
 */
export function PlanGroupPanel(props: {
  readonly group: AgentPlanGroup;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <PlanFloatingPanel
      type="group"
      label={t("plans.groups.panel.label", { name: props.group.name })}
      kicker={t("plans.groups.panel.kicker")}
      title={props.group.name}
      closeLabel={t("plans.groups.panel.close")}
      closeButton={t("plans.groups.panel.closeButton")}
      hint={t("plans.groups.panel.draftHint")}
      onClose={props.onClose}
    >
      <PlanGroupEditor
        group={props.group}
        draft={props.draft}
        sources={props.sources}
        graph={props.graph}
        disabled={props.isDisabled}
      />
    </PlanFloatingPanel>
  );
}
