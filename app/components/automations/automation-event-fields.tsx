import { PLAN_EVENT_TYPES } from "./automation-draft";
import { FieldSelect, FormField } from "./automation-form-controls";
import { eventKey, nameOf } from "./automation-labels";

import type { AutomationEventType } from "@/definition/Automation";
import type { FieldOption } from "./automation-form-controls";
import type { SectionProps } from "./automation-section-props";
import type { LabelContext } from "./automation-time-format";

/**
 * Keeps a saved reference selectable when the options no longer offer it,
 * so the field still names it.
 */
export function withSavedChoice(
  choices: readonly FieldOption[],
  value: string,
  context: LabelContext,
): readonly FieldOption[] {
  if (value === "" || choices.some((choice) => choice.value === value))
    return choices;
  return [{ value, label: nameOf(context, value) }, ...choices];
}

function eventTypeChange(
  props: SectionProps,
  eventType: AutomationEventType,
): void {
  const { draft, change, options } = props;
  const isPlanEvent = PLAN_EVENT_TYPES.has(eventType);
  change({
    eventType,
    stepId: "",
    statusId: "",
    projectId:
      isPlanEvent || draft.projectId !== ""
        ? draft.projectId
        : (options.projects[0]?.id ?? ""),
  });
}

/** Plan and step filters of a plan event. */
function PlanFilters(props: SectionProps): React.ReactElement {
  const { draft, change, isReadOnly, options, context } = props;
  const { t } = context;
  const plans = withSavedChoice(
    [
      { value: "", label: t("automations.fields.allPlans") },
      ...options.plans.map((plan) => ({ value: plan.id, label: plan.name })),
    ],
    draft.planId,
    context,
  );
  const plan = options.plans.find((entry) => entry.id === draft.planId);
  const hasStep =
    draft.eventType === "plan.step_changed" && draft.planId !== "";
  const steps = withSavedChoice(
    [
      { value: "", label: t("automations.fields.allSteps") },
      ...(plan?.steps ?? []).map((step) => ({
        value: step.id,
        label: step.name,
      })),
    ],
    draft.stepId,
    context,
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldSelect
        label={t("automations.fields.plan")}
        value={draft.planId}
        options={plans}
        onChange={(planId) => change({ planId, stepId: "" })}
        isReadOnly={isReadOnly}
        className={hasStep ? undefined : "col-span-2"}
      />
      {hasStep ? (
        <FieldSelect
          label={t("automations.fields.step")}
          value={draft.stepId}
          options={steps}
          onChange={(stepId) => change({ stepId })}
          isReadOnly={isReadOnly}
        />
      ) : null}
    </div>
  );
}

/** Project and target status filters of a ticket event. */
function TicketFilters(props: SectionProps): React.ReactElement {
  const { draft, change, isReadOnly, options, context } = props;
  const { t } = context;
  const projects = withSavedChoice(
    options.projects.map((project) => ({
      value: project.id,
      label: project.name,
    })),
    draft.projectId,
    context,
  );
  const project = options.projects.find(
    (entry) => entry.id === draft.projectId,
  );
  const hasStatus = draft.eventType === "ticket.status_changed";
  const statuses = withSavedChoice(
    [
      { value: "", label: t("automations.fields.anyStatus") },
      ...(project?.statuses ?? []).map((status) => ({
        value: status.id,
        label: status.name,
      })),
    ],
    draft.statusId,
    context,
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldSelect
        label={t("automations.fields.project")}
        value={draft.projectId}
        options={projects}
        onChange={(projectId) => change({ projectId, statusId: "" })}
        isReadOnly={isReadOnly}
        className={hasStatus ? undefined : "col-span-2"}
      />
      {hasStatus ? (
        <FieldSelect
          label={t("automations.fields.targetStatus")}
          value={draft.statusId}
          options={statuses}
          onChange={(statusId) => change({ statusId })}
          isReadOnly={isReadOnly}
        />
      ) : null}
    </div>
  );
}

/**
 * The fields of an event trigger: the event, its filters and an example of
 * the data the event hands to the action.
 */
export function EventFields(props: SectionProps): React.ReactElement {
  const { draft, isReadOnly, options, context } = props;
  const { t } = context;
  const eventTypes = options.eventTypes.map((eventType) => ({
    value: eventType,
    label: t(`automations.events.${eventKey(eventType)}`),
  }));
  const example = options.eventExamples[draft.eventType];
  return (
    <>
      <FieldSelect<AutomationEventType>
        label={t("automations.fields.event")}
        value={draft.eventType}
        options={eventTypes}
        onChange={(eventType) => eventTypeChange(props, eventType)}
        isReadOnly={isReadOnly}
      />
      {PLAN_EVENT_TYPES.has(draft.eventType) ? (
        <PlanFilters {...props} />
      ) : (
        <TicketFilters {...props} />
      )}
      <FormField label={t("automations.fields.eventData")}>
        <pre className="max-h-48 overflow-auto rounded-xl bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
          {JSON.stringify(example, null, 2)}
        </pre>
      </FormField>
    </>
  );
}
