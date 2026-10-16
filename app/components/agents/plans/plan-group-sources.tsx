import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { planGroupAdapter } from "@/definition/AgentPlanGroup";

import { PlanGroupAdapterBadge } from "./plan-group-adapter";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** Creates neutral group drafts and lists the groups with their ACP class. */
export function PlanGroupSources(props: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly disabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="space-y-3" aria-label={t("plans.tabs.groups")}>
      <Button
        disabled={props.disabled}
        onClick={() => props.graph.add("group", t("plans.groups.defaultName"))}
      >
        {t("plans.groups.create")}
      </Button>
      <p className="text-sm text-muted-foreground">{t("plans.groups.hint")}</p>
      <ul className="space-y-2">
        {props.draft.nodes
          .filter((node) => node.type === "group")
          .map((group) => (
            <li key={group.id} className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => props.graph.select(group.id)}
              >
                {group.name} ({group.steps.length})
              </Button>
              <PlanGroupAdapterBadge
                adapter={planGroupAdapter(group, props.sources.agents)}
              />
            </li>
          ))}
      </ul>
    </section>
  );
}
