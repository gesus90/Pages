import { EventFields } from "./automation-event-fields";
import { ChoiceRow } from "./automation-form-controls";
import { ScheduleFields } from "./automation-schedule-fields";

import type { DraftTriggerKind } from "./automation-draft";
import type { ScheduleProps } from "./automation-schedule-fields";

/** "Auslöser" with the fields of a time, an event or a manual trigger. */
export function TriggerFields(props: ScheduleProps): React.ReactElement {
  const { draft, change, isReadOnly, context } = props;
  const { t } = context;
  const kinds = [
    { value: "time" as const, label: t("automations.fields.triggerTime") },
    { value: "event" as const, label: t("automations.fields.triggerEvent") },
    { value: "manual" as const, label: t("automations.fields.triggerManual") },
  ];
  return (
    <>
      <ChoiceRow<DraftTriggerKind>
        label={t("automations.fields.trigger")}
        value={draft.triggerKind}
        options={kinds}
        onChange={(triggerKind) => change({ triggerKind })}
        isReadOnly={isReadOnly}
      />
      {draft.triggerKind === "time" ? <ScheduleFields {...props} /> : null}
      {draft.triggerKind === "event" ? <EventFields {...props} /> : null}
      {draft.triggerKind === "manual" ? (
        <p className="text-xs text-muted-foreground">
          {t("automations.fields.manualHint")}
        </p>
      ) : null}
    </>
  );
}
