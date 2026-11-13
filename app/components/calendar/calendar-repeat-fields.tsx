import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import {
  CALENDAR_FREQUENCIES,
  CALENDAR_LIMITS,
  CALENDAR_WEEKDAYS,
} from "@/definition/Calendar";

import { useCalendarContext } from "./calendar-context";
import { weekdayKeyOf } from "./calendar-dates";
import { REPEAT_PRESETS } from "./calendar-recurrence";

import type { CalendarFrequency, CalendarWeekday } from "@/definition/Calendar";
import type { RepeatEnd, RepeatFields } from "./calendar-recurrence";

interface CalendarRepeatFieldsProps {
  readonly repeat: RepeatFields;
  /** The first day of the event, for the labels of the choices. */
  readonly date: string;
  readonly onChange: (repeat: RepeatFields) => void;
}

const END_CHOICES: readonly RepeatEnd[] = ["never", "until", "count"];
const LABEL_CLASS_NAME = "text-xs font-medium text-muted-foreground";

function clampNumber(text: string, maximum: number): number {
  const parsed = Math.trunc(Number(text));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), maximum) : 1;
}

/** „Alle N Tage/Wochen/Monate/Jahre“ and the weekdays of a weekly rule. */
function CustomRule({
  repeat,
  onChange,
}: Omit<CalendarRepeatFieldsProps, "date">): React.ReactElement {
  const { t } = useTranslation();
  const { format } = useCalendarContext();
  const intervalId = useId();

  function toggleWeekday(day: CalendarWeekday): void {
    const weekdays = repeat.weekdays.includes(day)
      ? repeat.weekdays.filter((known) => known !== day)
      : [...repeat.weekdays, day];
    onChange({ ...repeat, weekdays });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className={LABEL_CLASS_NAME} htmlFor={intervalId}>
          {t("calendar.form.every")}
        </label>
        <Input
          id={intervalId}
          type="number"
          size="sm"
          className="w-20"
          min={1}
          max={CALENDAR_LIMITS.intervalMaximum}
          value={repeat.interval}
          onChange={(event) =>
            onChange({
              ...repeat,
              interval: clampNumber(
                event.target.value,
                CALENDAR_LIMITS.intervalMaximum,
              ),
            })
          }
        />
        <Select<CalendarFrequency>
          ariaLabel={t("calendar.form.unit")}
          value={repeat.frequency}
          options={CALENDAR_FREQUENCIES.map((frequency) => ({
            value: frequency,
            label: t(`calendar.form.units.${frequency}`, {
              count: repeat.interval,
            }),
          }))}
          onValueChange={(frequency) => onChange({ ...repeat, frequency })}
        />
      </div>
      {repeat.frequency === "weekly" ? (
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label={t("calendar.form.weekdays")}
        >
          {CALENDAR_WEEKDAYS.map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={repeat.weekdays.includes(day)}
              className={cn(
                "rounded-md border border-border px-2 py-1 text-xs text-muted-foreground",
                repeat.weekdays.includes(day) &&
                  "border-primary bg-primary-subtle text-foreground",
              )}
              onClick={() => toggleWeekday(day)}
            >
              {format.weekdayName(day).slice(0, 2)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** How the series ends: never, on a date or after a number of events. */
function RepeatEndFields({
  repeat,
  onChange,
}: Omit<CalendarRepeatFieldsProps, "date">): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select<RepeatEnd>
        ariaLabel={t("calendar.form.ends")}
        value={repeat.end}
        options={END_CHOICES.map((end) => ({
          value: end,
          label: t(`calendar.form.end.${end}`),
        }))}
        onValueChange={(end) => onChange({ ...repeat, end })}
      />
      {repeat.end === "until" ? (
        <Input
          type="date"
          size="sm"
          className="w-40"
          aria-label={t("calendar.form.end.until")}
          value={repeat.until}
          onChange={(event) =>
            onChange({ ...repeat, until: event.target.value })
          }
        />
      ) : null}
      {repeat.end === "count" ? (
        <Input
          type="number"
          size="sm"
          className="w-24"
          min={1}
          max={CALENDAR_LIMITS.countMaximum}
          aria-label={t("calendar.form.end.count")}
          value={repeat.count}
          onChange={(event) =>
            onChange({
              ...repeat,
              count: clampNumber(
                event.target.value,
                CALENDAR_LIMITS.countMaximum,
              ),
            })
          }
        />
      ) : null}
    </div>
  );
}

/** „Wiederholen“: the choices of a rule, a custom rule and its end. */
export function CalendarRepeatFields({
  repeat,
  date,
  onChange,
}: CalendarRepeatFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const { format } = useCalendarContext();
  const presetId = useId();
  const labels = {
    weekday: format.weekdayName(weekdayKeyOf(date)),
    day: Number(date.slice(8, 10)),
    date: format.dayMonth(date),
  };

  return (
    <div className="flex flex-col gap-2">
      <label className={LABEL_CLASS_NAME} htmlFor={presetId}>
        {t("calendar.form.repeat")}
      </label>
      <Select
        id={presetId}
        size="default"
        className="w-full"
        value={repeat.preset}
        options={REPEAT_PRESETS.map((preset) => ({
          value: preset,
          label: t(`calendar.form.presets.${preset}`, labels),
        }))}
        onValueChange={(preset) => onChange({ ...repeat, preset })}
      />
      {repeat.preset === "custom" ? (
        <CustomRule repeat={repeat} onChange={onChange} />
      ) : null}
      {repeat.preset === "never" ? null : (
        <RepeatEndFields repeat={repeat} onChange={onChange} />
      )}
    </div>
  );
}
