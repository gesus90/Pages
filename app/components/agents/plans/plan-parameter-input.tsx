import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { planNodeLabel } from "./plan-layout";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

/** Literal values reuse A10.2 types; source and result values use explicitly selected ports. */
export function PlanParameterInput(props: {
  readonly parameter: AgentParameter;
  readonly step: AgentPlanStep;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly disabled: boolean;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { parameter, step } = props;
  const binding = step.bindings[parameter.name];
  const literal =
    binding?.kind === "literal" ? binding.value : parameter.defaultValue;
  function change(next: AgentPlanBinding): void {
    props.onChange({
      ...step,
      bindings: { ...step.bindings, [parameter.name]: next },
    });
  }
  function reset(): void {
    const bindings = Object.fromEntries(
      Object.entries(step.bindings).filter(([name]) => name !== parameter.name),
    );
    props.onChange({ ...step, bindings });
  }
  const label = `${parameter.name} (${parameter.type})`;
  return (
    <fieldset
      disabled={props.disabled}
      className="space-y-2 rounded-lg border border-border p-3"
    >
      <legend className="px-1 text-sm font-medium">
        {label}
        {parameter.isRequired ? " *" : ""}
      </legend>
      <p className="text-xs text-muted-foreground">{parameter.description}</p>
      {parameter.type === "text" ? (
        <TextBinding
          parameter={parameter}
          binding={binding}
          draft={props.draft}
          sources={props.sources}
          onChange={change}
          disabled={props.disabled}
        />
      ) : null}
      {parameter.type === "workspace" ? (
        <Select
          value={literal?.type === "workspace" ? literal.workspaceId : ""}
          ariaLabel={label}
          disabled={props.disabled}
          options={[
            { value: "", label: t("plans.useDefault") },
            ...props.workspaces.map((workspace) => ({
              value: workspace.id,
              label: workspace.name,
              disabled: !workspace.isUsable,
            })),
          ]}
          onValueChange={(workspaceId) =>
            change({
              kind: "literal",
              value: workspaceId ? { type: "workspace", workspaceId } : null,
            })
          }
        />
      ) : null}
      {parameter.type === "wiki" ? (
        <Input
          aria-label={label}
          placeholder={t("plans.wikiId")}
          value={literal?.type === "wiki" ? literal.pageId : ""}
          onChange={(event) =>
            change({
              kind: "literal",
              value: event.target.value
                ? { type: "wiki", pageId: event.target.value }
                : null,
            })
          }
        />
      ) : null}
      {binding ? (
        <Button size="sm" variant="ghost" onClick={reset}>
          {t("plans.resetBinding")}
        </Button>
      ) : null}
    </fieldset>
  );
}

function TextBinding(props: {
  readonly parameter: AgentParameter;
  readonly binding: AgentPlanBinding | undefined;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly disabled: boolean;
  readonly onChange: (binding: AgentPlanBinding) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { binding, parameter } = props;
  let selected = "literal";
  if (binding?.kind === "source") selected = `source:${binding.nodeId}`;
  if (binding?.kind === "result") selected = `result:${binding.stepId}`;
  const options = [
    { value: "literal", label: t("plans.literalText") },
    ...props.draft.nodes.map((node) => ({
      value: `${node.type === "agent" ? "result" : "source"}:${node.id}`,
      label: planNodeLabel(node, props.sources),
    })),
  ];
  function select(next: string): void {
    const [kind, id] = next.split(":");
    if (kind === "source") props.onChange({ kind, nodeId: id });
    else if (kind === "result") props.onChange({ kind, stepId: id });
    else props.onChange({ kind: "literal", value: { type: "text", text: "" } });
  }
  const literal =
    binding?.kind === "literal" ? binding.value : parameter.defaultValue;
  return (
    <div className="space-y-2">
      <Select
        value={selected}
        ariaLabel={t("plans.bindingSource", { name: parameter.name })}
        options={options}
        onValueChange={select}
        disabled={props.disabled}
      />
      {selected === "literal" ? (
        <Textarea
          aria-label={parameter.name}
          value={literal?.type === "text" ? literal.text : ""}
          maxLength={200000}
          onChange={(event) =>
            props.onChange({
              kind: "literal",
              value: { type: "text", text: event.target.value },
            })
          }
        />
      ) : null}
    </div>
  );
}
