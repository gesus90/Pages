import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { AgentTicketValue } from "@/app/components/settings/agents/agent-ticket-value";
import { planValueIssue } from "@/definition/AgentPlanValue";
import { isAgentParameterName } from "@/definition/AgentParameters";

import type { AgentPlanParameter } from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

type ValueKind = "string" | "number" | "json" | "ticket" | "workspace" | "wiki";

/** One name and one typed value; JSON objects remain a single parameter. */
export function PlanValueFields(props: {
  readonly node: AgentPlanParameter;
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly disabled: boolean;
  readonly onChange: (node: AgentPlanParameter) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { node } = props;
  const kind: ValueKind =
    node.value.type === "text" ? node.format : node.value.type;
  const issue = planValueIssue(node);
  function changeKind(next: ValueKind): void {
    if (next === "number")
      props.onChange({
        ...node,
        format: "number",
        value: { type: "number", number: 0 },
      });
    else if (next === "ticket")
      props.onChange({
        ...node,
        format: "string",
        value: { type: "ticket", ticketId: "" },
      });
    else if (next === "workspace")
      props.onChange({
        ...node,
        format: "string",
        value: { type: "workspace", workspaceId: "" },
      });
    else if (next === "wiki")
      props.onChange({
        ...node,
        format: "string",
        value: { type: "wiki", pageId: "" },
      });
    else
      props.onChange({
        ...node,
        format: next,
        value: {
          type: "text",
          text: node.value.type === "text" ? node.value.text : "",
        },
      });
  }
  return (
    <fieldset disabled={props.disabled} className="space-y-2">
      <label className="block space-y-1 text-sm">
        <span>{t("plans.variableName")}</span>
        <Input
          value={node.name}
          maxLength={64}
          onChange={(event) =>
            props.onChange({ ...node, name: event.target.value })
          }
        />
      </label>
      {!isAgentParameterName(node.name) ? (
        <p role="alert" className="text-xs text-destructive">
          {t("plans.validation.name")}
        </p>
      ) : null}
      <Select<ValueKind>
        ariaLabel={t("plans.valueType")}
        value={kind}
        disabled={props.disabled}
        onValueChange={changeKind}
        options={(
          ["string", "number", "json", "ticket", "workspace", "wiki"] as const
        ).map((value) => ({ value, label: t(`plans.valueTypes.${value}`) }))}
      />
      <ValueInput {...props} />
      {issue ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`plans.validation.${issue}`)}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t("plans.singleValueHint")}
      </p>
    </fieldset>
  );
}

function ValueInput(props: {
  readonly node: AgentPlanParameter;
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly disabled: boolean;
  readonly onChange: (node: AgentPlanParameter) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { node } = props;
  return (
    <>
      {node.value.type === "number" ? (
        <Input
          aria-label={t("plans.variableValue", { name: node.name })}
          type="number"
          step="any"
          value={Number.isFinite(node.value.number) ? node.value.number : ""}
          onChange={(event) =>
            props.onChange({
              ...node,
              value: { type: "number", number: event.target.valueAsNumber },
            })
          }
        />
      ) : null}
      {node.value.type === "ticket" ? (
        <AgentTicketValue
          ticketId={node.value.ticketId}
          disabled={props.disabled}
          onChange={(ticketId) =>
            props.onChange({ ...node, value: { type: "ticket", ticketId } })
          }
        />
      ) : null}
      {node.value.type === "text" ? (
        <label className="block space-y-1 text-sm">
          <span>{t("plans.variableValue", { name: node.name })}</span>
          <Textarea
            value={node.value.text}
            maxLength={200000}
            onChange={(event) =>
              props.onChange({
                ...node,
                value: { type: "text", text: event.target.value },
              })
            }
          />
        </label>
      ) : null}
      {node.value.type === "workspace" ? (
        <Select
          ariaLabel={t("plans.workspace")}
          value={node.value.workspaceId}
          disabled={props.disabled}
          options={[
            { value: "", label: t("plans.chooseWorkspace") },
            ...props.workspaces.map((workspace) => ({
              value: workspace.id,
              label: workspace.name,
              disabled: !workspace.isUsable,
            })),
          ]}
          onValueChange={(workspaceId) =>
            props.onChange({
              ...node,
              value: { type: "workspace", workspaceId },
            })
          }
        />
      ) : null}
      {node.value.type === "wiki" ? (
        <Input
          aria-label={t("plans.wikiId")}
          placeholder={t("plans.wikiId")}
          value={node.value.pageId}
          maxLength={100}
          onChange={(event) =>
            props.onChange({
              ...node,
              value: { type: "wiki", pageId: event.target.value },
            })
          }
        />
      ) : null}
    </>
  );
}
