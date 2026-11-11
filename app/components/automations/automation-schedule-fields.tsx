import { useId } from "react";

import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { SearchableSelect } from "@/app/components/ui/searchable-select";
import { cn } from "@/app/lib/cn";

import { ChoiceRow, FieldValue, FormField } from "./automation-form-controls";
import { IntervalFields } from "./automation-interval-fields";
import { EMPTY_CELL } from "./automation-time-format";
import { zonedInputToIso } from "./automation-zoned-time";

import type { DraftRepeat } from "./automation-draft";
import type { SectionProps } from "./automation-section-props";
import type { TimeAlert } from "./use-automation-editor";

/** The schedule fields with the mark of an unusable time. */
export interface ScheduleProps extends SectionProps {
  readonly timeAlert: TimeAlert | null;
}

function savedDate(props: ScheduleProps): string {
  const { draft, context } = props;
  const iso = zonedInputToIso(
    { date: draft.date, time: draft.time },
    draft.timeZone,
  );
  if (!iso) return EMPTY_CELL;
  return new Intl.DateTimeFormat(context.language, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: draft.timeZone,
  }).format(new Date(iso));
}

/** The time zone the schedule is meant in, with a search over every zone. */
function TimeZoneField({
  draft,
  change,
  options,
  context,
}: SectionProps): React.ReactElement {
  const { t } = context;
  const id = useId();
  const zones = options.timeZones.includes(draft.timeZone)
    ? options.timeZones
    : [draft.timeZone, ...options.timeZones];
  return (
    <FormField label={t("automations.fields.timeZone")} htmlFor={id}>
      <SearchableSelect
        id={id}
        label={t("automations.fields.timeZone")}
        value={draft.timeZone}
        options={zones.map((zone) => ({ value: zone, label: zone }))}
        onValueChange={(timeZone) => change({ timeZone })}
        texts={{
          placeholder: t("automations.timeZone.placeholder"),
          unavailable: t("automations.timeZone.unavailable"),
          search: t("automations.timeZone.search"),
          empty: t("automations.timeZone.empty"),
          count: (count, total) =>
            t("automations.timeZone.count", { count, total }),
        }}
      />
    </FormField>
  );
}

/** Date and time of a once trigger; red when switching on needs a new time. */
function OnceFields(props: ScheduleProps): React.ReactElement {
  const { draft, change, isReadOnly, context, timeAlert } = props;
  const { t } = context;
  const dateId = useId();
  const timeId = useId();
  const alertClass = cn(timeAlert && "border border-destructive");
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label={t("automations.fields.date")}
          htmlFor={isReadOnly ? undefined : dateId}
        >
          {isReadOnly ? (
            <FieldValue>{savedDate(props)}</FieldValue>
          ) : (
            <Input
              aria-invalid={timeAlert !== null}
              className={alertClass}
              id={dateId}
              type="date"
              value={draft.date}
              onChange={(event) => change({ date: event.currentTarget.value })}
            />
          )}
        </FormField>
        <FormField
          label={t("automations.fields.time")}
          htmlFor={isReadOnly ? undefined : timeId}
        >
          {isReadOnly ? (
            <FieldValue>
              {draft.time === ""
                ? EMPTY_CELL
                : `${draft.time} · ${draft.timeZone}`}
            </FieldValue>
          ) : (
            <Input
              aria-invalid={timeAlert !== null}
              className={alertClass}
              id={timeId}
              type="time"
              value={draft.time}
              onChange={(event) => change({ time: event.currentTarget.value })}
            />
          )}
        </FormField>
      </div>
      {timeAlert ? (
        <p className="text-xs text-destructive" role="alert">
          {t(`automations.timeAlert.${timeAlert}`)}
        </p>
      ) : null}
    </>
  );
}

/** "Nach dem Lauf löschen", offered for a once trigger only. */
function DeleteAfterField({
  draft,
  change,
  isReadOnly,
  context,
}: SectionProps): React.ReactElement {
  const { t } = context;
  const id = useId();
  const isOnce = draft.repeat === "once";
  return (
    <div className={cn("flex items-center gap-2.5", !isOnce && "opacity-60")}>
      <Checkbox
        checked={isOnce && draft.deleteAfterSuccess}
        className="disabled:opacity-100"
        disabled={isReadOnly || !isOnce}
        id={id}
        onChange={(event) =>
          change({ deleteAfterSuccess: event.currentTarget.checked })
        }
      />
      <label className="text-sm" htmlFor={id}>
        {t("automations.fields.deleteAfter")}
      </label>
      {isOnce ? null : (
        <span className="text-xs text-muted-foreground">
          {t("automations.fields.deleteAfterOnceOnly")}
        </span>
      )}
    </div>
  );
}

/** "Wiederholung" with the fields of a once or a recurring trigger. */
export function ScheduleFields(props: ScheduleProps): React.ReactElement {
  const { draft, change, isReadOnly, context } = props;
  const { t } = context;
  const repeats = [
    { value: "once" as const, label: t("automations.fields.repeatOnce") },
    {
      value: "interval" as const,
      label: t("automations.fields.repeatInterval"),
    },
  ];
  return (
    <>
      <ChoiceRow<DraftRepeat>
        label={t("automations.fields.repeat")}
        value={draft.repeat}
        options={repeats}
        onChange={(repeat) => change({ repeat })}
        isReadOnly={isReadOnly}
      />
      {draft.repeat === "once" ? (
        <OnceFields {...props} />
      ) : (
        <IntervalFields {...props} />
      )}
      {isReadOnly ? null : <TimeZoneField {...props} />}
      <DeleteAfterField {...props} />
    </>
  );
}
