import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import { isAgentParameterName } from "@/definition/AgentParameters";
import { planValueIssue } from "@/definition/AgentPlanValue";

import { usePlanFlowContext } from "../plan-flow-context";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PLAN_FIELD_CLASS, PlanValueInput } from "./plan-value-input";
import { PlanValueOut } from "./plan-value-out";

import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanParameter } from "@/definition/AgentPlan";

type ValueKind = "string" | "number" | "json" | "ticket" | "workspace" | "wiki";

const VALUE_KINDS: readonly ValueKind[] = [
  "string",
  "number",
  "json",
  "ticket",
  "workspace",
  "wiki",
];

/** The node with a value of another kind; text survives a change between text formats. */
function withKind(
  node: AgentPlanParameter,
  kind: ValueKind,
): AgentPlanParameter {
  if (kind === "string" || kind === "json")
    return {
      ...node,
      format: kind,
      value: {
        type: "text",
        text: node.value.type === "text" ? node.value.text : "",
      },
    };
  const empty: Record<
    Exclude<ValueKind, "string" | "json">,
    AgentParameterValue
  > = {
    number: { type: "number", number: 0 },
    ticket: { type: "ticket", ticketId: "" },
    workspace: { type: "workspace", workspaceId: "" },
    wiki: { type: "wiki", pageId: "" },
  };
  return {
    ...node,
    format: kind === "number" ? "number" : "string",
    value: empty[kind],
  };
}

function FieldRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid h-8 grid-cols-[3rem_minmax(0,1fr)] items-center gap-2">
      <span
        className={cn("truncate text-muted-foreground", PLAN_NODE_TEXT.field)}
      >
        {props.label}
      </span>
      {props.children}
    </div>
  );
}

/**
 * Name, type and value of a parameter node, edited in place.
 *
 * @remarks
 * The name stays the stable key of the value; the data OUT sits at the row
 * of the value it sends.
 */
export function PlanParameterFields(props: {
  readonly node: AgentPlanParameter;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { node } = props;
  const kind: ValueKind =
    node.value.type === "text" ? node.format : node.value.type;
  const issue = planValueIssue(node);
  const isNameValid = isAgentParameterName(node.name);
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-3">
      <FieldRow label={t("plans.field.name")}>
        <Input
          size="sm"
          aria-label={t("plans.parameterName")}
          aria-invalid={!isNameValid}
          title={node.name}
          value={node.name}
          maxLength={64}
          disabled={!canEdit}
          className={cn(
            PLAN_FIELD_CLASS,
            "font-mono",
            !isNameValid && "border-destructive",
          )}
          onChange={(event) =>
            graph.replaceNode({ ...node, name: event.target.value })
          }
        />
      </FieldRow>
      <FieldRow label={t("plans.field.type")}>
        <Select<ValueKind>
          ariaLabel={t("plans.parameterType", { name: node.name })}
          value={kind}
          disabled={!canEdit}
          className={PLAN_FIELD_CLASS}
          options={VALUE_KINDS.map((value) => ({
            value,
            label: t(`plans.valueTypes.${value}`),
          }))}
          onValueChange={(next) => graph.replaceNode(withKind(node, next))}
        />
      </FieldRow>
      <div className="relative h-8">
        <PlanValueInput
          type={node.value.type}
          value={node.value}
          isJson={kind === "json"}
          label={t("plans.parameterValue", { name: node.name })}
          placeholder={t("plans.field.value")}
          hasIssue={issue !== null}
          disabled={!canEdit}
          onChange={(value) => graph.replaceNode({ ...node, value })}
        />
        <PlanValueOut nodeId={node.id} labelKey="plans.valueOut" />
      </div>
      {!isNameValid ? (
        <p role="alert" className={cn("text-destructive", PLAN_NODE_TEXT.meta)}>
          {t("plans.validation.name")}
        </p>
      ) : null}
      {issue ? (
        <p role="alert" className={cn("text-destructive", PLAN_NODE_TEXT.meta)}>
          {t(`plans.validation.${issue}`)}
        </p>
      ) : null}
    </div>
  );
}
