import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { PlanGlobals } from "./plan-globals";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** Adds individual values to the grid; existing global values stay editable in older plans. */
export function PlanParameters(props: {
  readonly draft: AgentPlanInput;
  readonly graph: PlanGraphActions;
  readonly disabled: boolean;
  readonly onChange: (draft: AgentPlanInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const parameters = props.draft.nodes.filter(
    (node) => node.type === "parameter",
  );
  return (
    <div className="space-y-3">
      <Button
        size="sm"
        disabled={props.disabled}
        onClick={() =>
          props.graph.add("parameter", `parameter_${parameters.length + 1}`)
        }
      >
        {t("plans.newVariable")}
      </Button>
      <ul className="space-y-1">
        {parameters.map((node) => (
          <li key={node.id}>
            <Button
              size="sm"
              variant="ghost"
              className="max-w-full truncate"
              onClick={() => props.graph.select(node.id)}
            >
              {node.name}
            </Button>
          </li>
        ))}
      </ul>
      {Object.keys(props.draft.globals).length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm">
            {t("plans.globals")}
          </summary>
          <PlanGlobals {...props} />
        </details>
      ) : null}
    </div>
  );
}
