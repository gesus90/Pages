import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { planSourceType } from "@/definition/AgentPlanGraph";

import { planNodeLabel } from "./plan-layout";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type {
  AgentPlanGroup,
  AgentPlanGroupParameter,
} from "@/definition/AgentPlanGroup";

/** Shows and edits the external source beside its boundary and internal targets. */
export function PlanGroupBoundarySource(props: {
  readonly group: AgentPlanGroup;
  readonly port: AgentPlanGroupParameter;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly disabled: boolean;
  readonly onChange: (group: AgentPlanGroup) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const binding = props.group.bindings[props.port.name];
  const selected = binding?.kind === "source" ? binding.nodeId : "";
  const options = props.draft.nodes
    .filter((node) => planSourceType(node) === props.port.type)
    .map((node) => ({
      value: node.id,
      label: planNodeLabel(node, props.sources),
    }));
  if (selected && !options.some((option) => option.value === selected))
    options.push({ value: selected, label: selected });
  function bind(source: string): void {
    if (props.disabled) return;
    const bindings = Object.fromEntries(
      Object.entries(props.group.bindings).filter(
        ([name]) => name !== props.port.name,
      ),
    );
    props.onChange({
      ...props.group,
      bindings: {
        ...bindings,
        ...(source
          ? { [props.port.name]: { kind: "source" as const, nodeId: source } }
          : {}),
      },
    });
  }
  return (
    <Select
      ariaLabel={t("plans.groups.externalSource", { name: props.port.name })}
      value={selected}
      disabled={props.disabled}
      options={[{ value: "", label: t("plans.useDefault") }, ...options]}
      onValueChange={bind}
    />
  );
}
