import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";

import { planNodeLabel } from "./plan-layout";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanGraphActions } from "./use-plan-graph";

/** Preserves legacy user work and offers explicit agent choices for unresolved frame edges. */
export function PlanGroupLegacy({
  group,
  draft,
  graph,
  sources,
  disabled,
}: {
  readonly group: AgentPlanGroup;
  readonly draft: AgentPlanInput;
  readonly graph: PlanGraphActions;
  readonly sources: AgentPlanSources;
  readonly disabled: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const edges = draft.edges.flatMap((edge, index) =>
    edge.from === group.id || edge.to === group.id ? [{ edge, index }] : [],
  );
  if (
    edges.length === 0 &&
    group.parameters.length === 0 &&
    Object.keys(group.bindings).length === 0
  )
    return null;
  return (
    <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
      {edges.length ? (
        <>
          <p role="alert" className="text-destructive">
            {t("plans.validation.groupBoundary")}
          </p>
          {edges.map(({ edge, index }) => (
            <div key={index} className="space-y-1">
              <span>
                {edge.from} → {edge.to}
              </span>
              <Select
                ariaLabel={t("plans.groups.chooseEndpoint")}
                value=""
                disabled={disabled}
                options={[
                  { value: "", label: t("plans.groups.chooseEndpoint") },
                  ...group.steps.map((step) => ({
                    value: step.id,
                    label: planNodeLabel(step, sources),
                  })),
                ]}
                onValueChange={(memberId) =>
                  graph.resolveGroupEdge(group.id, index, memberId)
                }
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  graph.disconnect({
                    kind: "flow",
                    from: edge.from,
                    to: edge.to,
                  })
                }
              >
                {t("plans.groups.removeLegacyEdge")}
              </Button>
            </div>
          ))}
        </>
      ) : null}
      {group.parameters.length || Object.keys(group.bindings).length ? (
        <details>
          <summary className="cursor-pointer">
            {t("plans.groups.legacy")}
          </summary>
          <p className="my-2 text-muted-foreground">
            {t("plans.groups.legacyHint")}
          </p>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(
              { parameters: group.parameters, bindings: group.bindings },
              null,
              2,
            )}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
