import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { planNodeLabel } from "./plan-layout";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";

/** A readable edge list provides explicit removal and an accessible alternative to visual arrows. */
export function PlanConnections(props: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly disabled: boolean;
  readonly onChange: (draft: AgentPlanInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function label(id: string): string {
    const node = props.draft.nodes.find((entry) => entry.id === id);
    return node ? planNodeLabel(node, props.sources) : id;
  }
  return (
    <section aria-label={t("plans.dependencies")} className="space-y-2">
      <h2 className="text-sm font-semibold">{t("plans.dependencies")}</h2>
      <ul className="space-y-1">
        {props.draft.edges.map((edge) => (
          <li
            key={`${edge.from}:${edge.to}`}
            className="flex items-center gap-2 text-sm"
          >
            <span>
              {label(edge.from)} → {label(edge.to)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={props.disabled}
              aria-label={t("plans.removeEdge", {
                from: label(edge.from),
                to: label(edge.to),
              })}
              onClick={() =>
                props.onChange({
                  ...props.draft,
                  edges: props.draft.edges.filter((entry) => entry !== edge),
                })
              }
            >
              {t("settings.agents.remove")}
            </Button>
          </li>
        ))}
      </ul>
      {props.draft.edges.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.noDependencies")}
        </p>
      ) : null}
    </section>
  );
}
