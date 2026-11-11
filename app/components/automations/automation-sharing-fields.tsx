import { AUTOMATION_NOTIFICATION_MODES } from "@/definition/Automation";

import { agentChoices } from "./automation-action-fields";
import { withSavedChoice } from "./automation-event-fields";
import { FieldSelect } from "./automation-form-controls";

import type { AutomationNotificationMode } from "@/definition/Automation";
import type { SectionProps } from "./automation-section-props";

/** "Freigabe": only me, a project or a group. */
function SharingField({
  draft,
  change,
  isReadOnly,
  options,
  context,
}: SectionProps): React.ReactElement {
  const { t } = context;
  const choices = [
    { value: "private", label: t("automations.fields.sharingPrivate") },
    ...options.sharing.projects.map((project) => ({
      value: `project:${project.id}`,
      label: t("automations.fields.sharingProject", { name: project.name }),
    })),
    ...options.sharing.groups.map((group) => ({
      value: `group:${group.id}`,
      label: t("automations.fields.sharingGroup", { name: group.name }),
    })),
  ];
  const savedId = draft.sharing.slice(draft.sharing.indexOf(":") + 1);
  const isKnown = choices.some((choice) => choice.value === draft.sharing);
  return (
    <FieldSelect
      label={t("automations.fields.sharing")}
      value={draft.sharing}
      options={
        isKnown
          ? choices
          : [
              {
                value: draft.sharing,
                label: context.names[savedId] ?? savedId,
              },
              ...choices,
            ]
      }
      onChange={(sharing) => change({ sharing })}
      isReadOnly={isReadOnly}
    />
  );
}

/** "Freigabe" and "Agent-Benachrichtigung" of an automation. */
export function SharingFields(props: SectionProps): React.ReactElement {
  const { draft, change, isReadOnly, options, context } = props;
  const { t } = context;
  const modes = AUTOMATION_NOTIFICATION_MODES.map((mode) => ({
    value: mode,
    label: t(`automations.fields.notificationModes.${mode}`),
  }));
  const hasAgent = draft.notificationMode !== "off";
  return (
    <>
      <SharingField {...props} />
      <div className="grid grid-cols-2 gap-3">
        <FieldSelect<AutomationNotificationMode>
          label={t("automations.fields.notification")}
          value={draft.notificationMode}
          options={modes}
          onChange={(notificationMode) => change({ notificationMode })}
          isReadOnly={isReadOnly}
          className={hasAgent ? undefined : "col-span-2"}
        />
        {hasAgent ? (
          <FieldSelect
            label={t("automations.fields.notificationAgent")}
            value={draft.notificationAgentId}
            options={withSavedChoice(
              agentChoices(options),
              draft.notificationAgentId,
              context,
            )}
            onChange={(notificationAgentId) => change({ notificationAgentId })}
            isReadOnly={isReadOnly}
          />
        ) : null}
      </div>
    </>
  );
}
