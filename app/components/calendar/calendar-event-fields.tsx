import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { CALENDAR_LIMITS } from "@/definition/Calendar";

import { CalendarInviteePicker } from "./calendar-invitee-picker";
import { CalendarRepeatFields } from "./calendar-repeat-fields";

import type { CalendarTarget } from "@/definition/Calendar";
import type { EventDraft } from "./calendar-event-draft";

interface CalendarEventFieldsProps {
  readonly draft: EventDraft;
  readonly targets: readonly CalendarTarget[];
  /** Whether the rule can change; not for a single occurrence of a series. */
  readonly canRepeat: boolean;
  readonly onChange: (change: Partial<EventDraft>) => void;
}

const LABEL_CLASS_NAME = "text-xs font-medium text-muted-foreground";

interface DraftInputProps {
  readonly label: string;
  readonly type: "date" | "time";
  readonly value: string;
  readonly min?: string;
  readonly className?: string;
  readonly onValue: (value: string) => void;
}

/** One labelled date or time input. */
function DraftInput({
  label,
  type,
  value,
  min,
  className,
  onValue,
}: DraftInputProps): React.ReactElement {
  const id = useId();

  return (
    <div className={className}>
      <label className={LABEL_CLASS_NAME} htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type={type}
        className="mt-1"
        required
        min={min}
        value={value}
        onChange={(event) => onValue(event.target.value)}
      />
    </div>
  );
}

/** Datum, Von and Bis, or Datum and „Datum bis“ of an all-day event. */
function WhenFields({
  draft,
  onChange,
}: Pick<CalendarEventFieldsProps, "draft" | "onChange">): React.ReactElement {
  const { t } = useTranslation();
  const allDayId = useId();

  function handleAllDay(event: React.ChangeEvent<HTMLInputElement>): void {
    onChange({
      allDay: event.target.checked,
      endDate: draft.endDate < draft.date ? draft.date : draft.endDate,
    });
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
        <DraftInput
          label={t("calendar.form.date")}
          type="date"
          value={draft.date}
          onValue={(date) => onChange({ date })}
        />
        {draft.allDay ? (
          <DraftInput
            className="sm:col-span-2"
            label={t("calendar.form.endDate")}
            type="date"
            min={draft.date}
            value={draft.endDate}
            onValue={(endDate) => onChange({ endDate })}
          />
        ) : (
          <>
            <DraftInput
              label={t("calendar.form.from")}
              type="time"
              value={draft.startTime}
              onValue={(startTime) => onChange({ startTime })}
            />
            <DraftInput
              label={t("calendar.form.to")}
              type="time"
              value={draft.endTime}
              onValue={(endTime) => onChange({ endTime })}
            />
          </>
        )}
      </div>
      <label
        className="flex items-center gap-2 text-sm text-foreground"
        htmlFor={allDayId}
      >
        <Checkbox
          id={allDayId}
          checked={draft.allDay}
          onChange={handleAllDay}
        />
        {t("calendar.form.allDay")}
      </label>
    </>
  );
}

/**
 * The fields of the event form: Titel, time, Wiederholen, Kalender,
 * Eingeladen and Beschreibung.
 */
export function CalendarEventFields({
  draft,
  targets,
  canRepeat,
  onChange,
}: CalendarEventFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const titleId = useId();
  const calendarId = useId();
  const descriptionId = useId();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className={LABEL_CLASS_NAME} htmlFor={titleId}>
          {t("calendar.form.title")}
        </label>
        <Input
          id={titleId}
          className="mt-1"
          required
          maxLength={CALENDAR_LIMITS.titleCharacters}
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
        />
      </div>
      <WhenFields draft={draft} onChange={onChange} />
      {canRepeat ? (
        <CalendarRepeatFields
          repeat={draft.repeat}
          date={draft.date}
          onChange={(repeat) => onChange({ repeat })}
        />
      ) : null}
      <div>
        <label className={LABEL_CLASS_NAME} htmlFor={calendarId}>
          {t("calendar.form.calendar")}
        </label>
        <Select
          id={calendarId}
          size="default"
          className="mt-1 w-full"
          value={draft.calendarProjectId}
          options={targets.map((target) => ({
            value: target.projectId ?? "",
            label: target.name,
          }))}
          onValueChange={(calendarProjectId) => onChange({ calendarProjectId })}
        />
      </div>
      <CalendarInviteePicker
        invitees={draft.invitees}
        onChange={(invitees) => onChange({ invitees })}
      />
      <div>
        <label className={LABEL_CLASS_NAME} htmlFor={descriptionId}>
          {t("calendar.form.description")}
        </label>
        <Textarea
          id={descriptionId}
          className="mt-1"
          rows={3}
          maxLength={CALENDAR_LIMITS.descriptionCharacters}
          value={draft.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>
    </div>
  );
}
