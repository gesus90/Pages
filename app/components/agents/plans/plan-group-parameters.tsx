import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { createRandomUuid } from "@/app/lib/random-uuid";

import type {
  AgentPlanGroup,
  AgentPlanGroupParameter,
} from "@/definition/AgentPlanGroup";
import type { AgentParameterType } from "@/definition/AgentParameters";

const PARAMETER_TYPES: readonly AgentParameterType[] = [
  "text",
  "number",
  "ticket",
  "workspace",
  "wiki",
];

/** Stable interface IDs keep removed or renamed ports distinguishable from new ports. */
export function PlanGroupParameters(props: {
  readonly group: AgentPlanGroup;
  readonly disabled: boolean;
  readonly onChange: (group: AgentPlanGroup) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function replace(port: AgentPlanGroupParameter): void {
    props.onChange({
      ...props.group,
      parameters: props.group.parameters.map((entry) =>
        entry.id === port.id ? port : entry,
      ),
    });
  }
  function add(): void {
    props.onChange({
      ...props.group,
      parameters: [
        ...props.group.parameters,
        {
          id: createRandomUuid(),
          name: `parameter${props.group.parameters.length + 1}`,
          type: "text",
          description: "",
          isRequired: true,
          defaultValue: null,
        },
      ],
    });
  }
  return (
    <fieldset disabled={props.disabled} className="space-y-2">
      <legend className="text-sm font-semibold">
        {t("plans.groups.interfaces")}
      </legend>
      {props.group.parameters.map((port) => (
        <GroupParameterRow
          key={port.id}
          group={props.group}
          port={port}
          onChange={replace}
          onRemove={() =>
            props.onChange({
              ...props.group,
              parameters: props.group.parameters.filter(
                (entry) => entry.id !== port.id,
              ),
            })
          }
        />
      ))}
      <Button size="sm" variant="outline" onClick={add}>
        {t("plans.groups.addPort")}
      </Button>
    </fieldset>
  );
}

function GroupParameterRow(props: {
  readonly group: AgentPlanGroup;
  readonly port: AgentPlanGroupParameter;
  readonly onChange: (port: AgentPlanGroupParameter) => void;
  readonly onRemove: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { port } = props;
  return (
    <div className="space-y-2 rounded-lg border border-border p-2">
      <Input
        aria-label={t("plans.groups.portName")}
        value={port.name}
        maxLength={64}
        onChange={(event) =>
          props.onChange({ ...port, name: event.target.value })
        }
      />
      <Select<AgentParameterType>
        ariaLabel={t("plans.groups.portType")}
        value={port.type}
        options={PARAMETER_TYPES.map((type) => ({
          value: type,
          label: type,
        }))}
        onValueChange={(type) =>
          props.onChange({ ...port, type, defaultValue: null })
        }
      />
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={port.isRequired}
          onChange={(event) =>
            props.onChange({ ...port, isRequired: event.target.checked })
          }
        />
        {t("plans.groups.required")}
      </label>
      <p className="text-xs text-muted-foreground">
        {port.name} →{" "}
        {props.group.steps
          .flatMap((step) =>
            Object.entries(step.bindings)
              .filter(
                ([, binding]) =>
                  binding.kind === "source" && binding.nodeId === port.id,
              )
              .map(
                ([name]) =>
                  `${step.configuration?.name ?? step.agentId}.${name}`,
              ),
          )
          .join(", ") || "—"}
      </p>
      <Button size="sm" variant="ghost" onClick={() => props.onRemove()}>
        {t("plans.groups.removePort")}
      </Button>
    </div>
  );
}
