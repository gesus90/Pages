import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { isAgentParameterName } from "@/definition/AgentParameters";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** Global values are literal text; adding a variable node makes its binding explicit. */
export function PlanGlobals(props: {
  readonly draft: AgentPlanInput;
  readonly disabled: boolean;
  readonly onChange: (draft: AgentPlanInput) => void;
  readonly graph: PlanGraphActions;
}): React.ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  function add(): void {
    if (!isAgentParameterName(name) || Object.hasOwn(props.draft.globals, name))
      return;
    props.onChange({
      ...props.draft,
      globals: { ...props.draft.globals, [name]: "" },
    });
    setName("");
  }
  function startDrag(
    event: React.DragEvent<HTMLButtonElement>,
    reference: string,
  ): void {
    event.dataTransfer.setData(
      "application/x-pages-plan",
      `variable:${reference}`,
    );
    event.dataTransfer.effectAllowed = "copy";
  }
  return (
    <fieldset
      disabled={props.disabled}
      className="space-y-2 rounded-xl border border-border p-3"
    >
      <legend className="px-1 text-sm font-semibold">
        {t("plans.globals")}
      </legend>
      {Object.entries(props.draft.globals).map(([reference, text]) => (
        <div key={reference} className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <span>{reference}</span>
            <Input
              aria-label={t("plans.variableValue", { name: reference })}
              value={text}
              onChange={(event) =>
                props.onChange({
                  ...props.draft,
                  globals: {
                    ...props.draft.globals,
                    [reference]: event.target.value,
                  },
                })
              }
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            draggable={!props.disabled}
            disabled={props.disabled || !props.draft.workspaceId}
            onDragStart={(event) => startDrag(event, reference)}
            onClick={() => props.graph.add("variable", reference)}
          >
            {t("plans.addVariable", { name: reference })}
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          aria-label={t("plans.variableName")}
          placeholder={t("plans.variableName")}
          value={name}
          maxLength={64}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={
            props.disabled ||
            !isAgentParameterName(name) ||
            Object.hasOwn(props.draft.globals, name)
          }
          onClick={add}
        >
          {t("plans.newVariable")}
        </Button>
      </div>
    </fieldset>
  );
}
