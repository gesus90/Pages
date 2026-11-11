import { useId } from "react";

import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";

import { withSavedChoice } from "./automation-event-fields";
import { ChoiceRow, FieldSelect, FormField } from "./automation-form-controls";

import type {
  AutomationActionType,
  AutomationForwardCondition,
  AutomationOptions,
} from "@/definition/Automation";
import type { FieldOption } from "./automation-form-controls";
import type { SectionProps } from "./automation-section-props";

const FORWARD_CONDITIONS: readonly AutomationForwardCondition[] = [
  "always",
  "nonzero",
  "zero",
];

/** The agents as "Name · Position". */
export function agentChoices(
  options: AutomationOptions,
): readonly FieldOption[] {
  return options.agents.map((agent) => ({
    value: agent.id,
    label: agent.position ? `${agent.name} · ${agent.position}` : agent.name,
  }));
}

/** The agent and the instruction it receives. */
function AgentFields({
  draft,
  change,
  isReadOnly,
  options,
  context,
}: SectionProps): React.ReactElement {
  const { t } = context;
  const id = useId();
  return (
    <>
      <FieldSelect
        label={t("automations.fields.agent")}
        value={draft.agentId}
        options={withSavedChoice(agentChoices(options), draft.agentId, context)}
        onChange={(agentId) => change({ agentId })}
        isReadOnly={isReadOnly}
      />
      <FormField label={t("automations.fields.instruction")} htmlFor={id}>
        <Textarea
          className="min-h-28"
          id={id}
          maxLength={options.limits.instructionLength}
          readOnly={isReadOnly}
          value={draft.instruction}
          onChange={(event) =>
            change({ instruction: event.currentTarget.value })
          }
        />
      </FormField>
    </>
  );
}

/** The script body, or why the account cannot read it. */
function ScriptContent({
  draft,
  change,
  isReadOnly,
  options,
  context,
}: SectionProps): React.ReactElement {
  const { t } = context;
  const id = useId();
  if (draft.content === null)
    return (
      <FormField label={t("automations.fields.script")}>
        <p className="rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
          {t("automations.fields.scriptHidden")}
        </p>
      </FormField>
    );
  return (
    <FormField label={t("automations.fields.script")} htmlFor={id}>
      <Textarea
        className="min-h-32 font-mono text-xs"
        id={id}
        maxLength={options.limits.script.contentLength}
        readOnly={isReadOnly}
        spellCheck={false}
        value={draft.content}
        onChange={(event) => change({ content: event.currentTarget.value })}
      />
    </FormField>
  );
}

/** Workspace, interpreter, timeout, body and the forward of a script. */
function ScriptFields(props: SectionProps): React.ReactElement {
  const { draft, change, options, context } = props;
  const { t } = context;
  const timeoutId = useId();
  // Without the body the account may not change the script at all.
  const isReadOnly = props.isReadOnly || draft.content === null;
  const workspaces = options.workspaces.map((entry) => ({
    value: entry.id,
    label: entry.name,
  }));
  const profiles = options.interpreterProfiles.map((entry) => ({
    value: entry.id,
    label: entry.name,
  }));
  const conditions = FORWARD_CONDITIONS.map((when) => ({
    value: when,
    label: t(`automations.fields.forwardWhen.${when}`),
  }));
  const forwardAgents = [
    { value: "", label: t("automations.fields.noAgent") },
    ...agentChoices(options),
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FieldSelect
          label={t("automations.fields.workspace")}
          value={draft.workspaceId}
          options={withSavedChoice(workspaces, draft.workspaceId, context)}
          onChange={(workspaceId) => change({ workspaceId })}
          isReadOnly={isReadOnly}
        />
        <FieldSelect
          label={t("automations.fields.interpreter")}
          value={draft.interpreterProfileId}
          options={withSavedChoice(
            profiles,
            draft.interpreterProfileId,
            context,
          )}
          onChange={(interpreterProfileId) => change({ interpreterProfileId })}
          isReadOnly={isReadOnly}
        />
      </div>
      <FormField label={t("automations.fields.timeout")} htmlFor={timeoutId}>
        <Input
          id={timeoutId}
          inputMode="numeric"
          max={options.limits.script.timeoutSeconds.maximum}
          min={options.limits.script.timeoutSeconds.minimum}
          readOnly={isReadOnly}
          type="number"
          value={draft.timeoutSeconds}
          onChange={(event) =>
            change({ timeoutSeconds: event.currentTarget.value })
          }
        />
      </FormField>
      <ScriptContent {...props} isReadOnly={isReadOnly} />
      <p className="text-xs font-medium text-muted-foreground">
        {t("automations.fields.forward")}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <FieldSelect
          label={t("automations.fields.forwardAgent")}
          value={draft.forwardAgentId}
          options={withSavedChoice(
            forwardAgents,
            draft.forwardAgentId,
            context,
          )}
          onChange={(forwardAgentId) => change({ forwardAgentId })}
          isReadOnly={isReadOnly}
        />
        <FieldSelect<AutomationForwardCondition>
          label={t("automations.fields.forwardWhenLabel")}
          value={draft.forwardWhen}
          options={conditions}
          onChange={(forwardWhen) => change({ forwardWhen })}
          isReadOnly={isReadOnly || draft.forwardAgentId === ""}
        />
      </div>
    </>
  );
}

/** The plan a new run is started of; only plans the account may start. */
function PlanActionFields({
  draft,
  change,
  isReadOnly,
  options,
  context,
}: SectionProps): React.ReactElement {
  const plans = options.plans
    .filter((plan) => plan.canStart)
    .map((plan) => ({ value: plan.id, label: plan.name }));
  return (
    <FieldSelect
      label={context.t("automations.fields.plan")}
      value={draft.actionPlanId}
      options={withSavedChoice(plans, draft.actionPlanId, context)}
      onChange={(actionPlanId) => change({ actionPlanId })}
      isReadOnly={isReadOnly}
    />
  );
}

/**
 * "Aktion": an agent, a script or a plan.
 *
 * @remarks
 * "Skript" is offered only to accounts that may run scripts, or shown when
 * a shared automation already runs one.
 */
export function ActionFields(props: SectionProps): React.ReactElement {
  const { draft, change, isReadOnly, options, context } = props;
  const { t } = context;
  const canScript = options.actions.some(
    (option) => option.type === "script" && option.isAllowed,
  );
  const kinds = [
    { value: "agent" as const, label: t("automations.fields.actionAgent") },
    ...(canScript || draft.actionType === "script"
      ? [
          {
            value: "script" as const,
            label: t("automations.fields.actionScript"),
          },
        ]
      : []),
    { value: "plan" as const, label: t("automations.fields.actionPlan") },
  ];
  return (
    <>
      <ChoiceRow<AutomationActionType>
        label={t("automations.fields.action")}
        value={draft.actionType}
        options={kinds}
        onChange={(actionType) => change({ actionType })}
        isReadOnly={isReadOnly}
      />
      {draft.actionType === "agent" ? <AgentFields {...props} /> : null}
      {draft.actionType === "script" ? <ScriptFields {...props} /> : null}
      {draft.actionType === "plan" ? <PlanActionFields {...props} /> : null}
    </>
  );
}
