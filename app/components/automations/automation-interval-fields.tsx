import { Plus, X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { AUTOMATION_TIME_UNITS } from "@/definition/Automation";

import {
  ChoiceRow,
  FieldSelect,
  FieldValue,
  FormField,
} from "./automation-form-controls";
import { weekdaysLabel } from "./automation-labels";
import { WeekdayPicker } from "./automation-weekday-picker";

import type { AutomationTimeUnit } from "@/definition/Automation";
import type { AutomationDraft, DraftIntervalMode } from "./automation-draft";
import type { SectionProps } from "./automation-section-props";

type WindowChoice = "always" | "between";

const ALL_WEEKDAYS = 7;

function everyText(
  draft: AutomationDraft,
  t: SectionProps["context"]["t"],
): string {
  const amount = t(`automations.units.${draft.unit}`, {
    count: Number(draft.every) || 0,
  });
  const isEveryDay =
    draft.weekdays.length === 0 || draft.weekdays.length === ALL_WEEKDAYS;
  return isEveryDay
    ? amount
    : `${amount} · ${weekdaysLabel(t, draft.weekdays)}`;
}

function windowText(
  draft: AutomationDraft,
  t: SectionProps["context"]["t"],
): string {
  if (!draft.hasWindow) return t("automations.fields.windowAlways");
  return `${draft.windowStart}–${draft.windowEnd}`;
}

/** The saved rhythm and window as plain values. */
function IntervalSummary({ draft, context }: SectionProps): React.ReactElement {
  const { t } = context;
  const isWeekly = draft.intervalMode === "weekly";
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField
        label={t(
          isWeekly ? "automations.fields.weeklyAt" : "automations.fields.every",
        )}
      >
        <FieldValue>
          {isWeekly
            ? `${weekdaysLabel(t, draft.weekdays)} ${draft.times.join(", ")}`
            : everyText(draft, t)}
        </FieldValue>
      </FormField>
      <FormField label={t("automations.fields.window")}>
        <FieldValue>{windowText(draft, t)}</FieldValue>
      </FormField>
    </div>
  );
}

/** "Alle N Einheiten" with optional weekdays. */
function EveryFields({
  draft,
  change,
  context,
}: SectionProps): React.ReactElement {
  const { t } = context;
  const id = useId();
  const units = AUTOMATION_TIME_UNITS.map((unit) => ({
    value: unit,
    label: t(`automations.unitNames.${unit}`),
  }));
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("automations.fields.every")} htmlFor={id}>
          <Input
            id={id}
            inputMode="numeric"
            min={1}
            type="number"
            value={draft.every}
            onChange={(event) => change({ every: event.currentTarget.value })}
          />
        </FormField>
        <FieldSelect<AutomationTimeUnit>
          label={t("automations.fields.unit")}
          value={draft.unit}
          options={units}
          onChange={(unit) => change({ unit })}
          isReadOnly={false}
        />
      </div>
      <WeekdayPicker
        label={t("automations.fields.weekdaysOptional")}
        weekdays={draft.weekdays}
        onChange={(weekdays) => change({ weekdays })}
      />
    </>
  );
}

/** The times of day of a weekly rhythm, one input each. */
function WeeklyTimes({
  draft,
  change,
  context,
}: SectionProps): React.ReactElement {
  const { t } = context;

  function setTime(index: number, time: string): void {
    change({
      times: draft.times.map((entry, position) =>
        position === index ? time : entry,
      ),
    });
  }

  return (
    <FormField label={t("automations.fields.times")}>
      <ul className="flex flex-col gap-2">
        {draft.times.map((time, index) => (
          <li className="flex items-center gap-2" key={index}>
            <Input
              aria-label={t("automations.fields.timeNumber", {
                number: index + 1,
              })}
              type="time"
              value={time}
              onChange={(event) => setTime(index, event.currentTarget.value)}
            />
            <Button
              aria-label={t("automations.fields.removeTime")}
              disabled={draft.times.length === 1}
              onClick={() =>
                change({
                  times: draft.times.filter(
                    (_, position) => position !== index,
                  ),
                })
              }
              size="icon-sm"
              variant="ghost"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        className="self-start"
        onClick={() => change({ times: [...draft.times, "12:00"] })}
        size="xs"
        variant="ghost"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {t("automations.fields.addTime")}
      </Button>
    </FormField>
  );
}

/** "Zeitfenster": around the clock or between two times. */
function WindowFields({
  draft,
  change,
  context,
}: SectionProps): React.ReactElement {
  const { t } = context;
  const startId = useId();
  const endId = useId();
  const choices = [
    { value: "always" as const, label: t("automations.fields.windowAlways") },
    { value: "between" as const, label: t("automations.fields.windowBetween") },
  ];
  return (
    <>
      <FieldSelect<WindowChoice>
        label={t("automations.fields.window")}
        value={draft.hasWindow ? "between" : "always"}
        options={choices}
        onChange={(choice) => change({ hasWindow: choice === "between" })}
        isReadOnly={false}
      />
      {draft.hasWindow ? (
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label={t("automations.fields.windowStart")}
            htmlFor={startId}
          >
            <Input
              id={startId}
              type="time"
              value={draft.windowStart}
              onChange={(event) =>
                change({ windowStart: event.currentTarget.value })
              }
            />
          </FormField>
          <FormField label={t("automations.fields.windowEnd")} htmlFor={endId}>
            <Input
              id={endId}
              type="time"
              value={draft.windowEnd}
              onChange={(event) =>
                change({ windowEnd: event.currentTarget.value })
              }
            />
          </FormField>
        </div>
      ) : null}
    </>
  );
}

/**
 * The fields of a recurring trigger: every N units or on weekdays at
 * times, and the daily window.
 */
export function IntervalFields(props: SectionProps): React.ReactElement {
  const { t } = useTranslation();
  const { draft, change, isReadOnly } = props;
  if (isReadOnly) return <IntervalSummary {...props} />;
  const modes = [
    { value: "every" as const, label: t("automations.fields.every") },
    { value: "weekly" as const, label: t("automations.fields.weeklyAt") },
  ];
  return (
    <>
      <ChoiceRow<DraftIntervalMode>
        label={t("automations.fields.rhythm")}
        value={draft.intervalMode}
        options={modes}
        onChange={(intervalMode) => change({ intervalMode })}
        isReadOnly={false}
      />
      {draft.intervalMode === "every" ? (
        <EveryFields {...props} />
      ) : (
        <>
          <WeekdayPicker
            label={t("automations.fields.weekdays")}
            weekdays={draft.weekdays}
            onChange={(weekdays) => change({ weekdays })}
          />
          <WeeklyTimes {...props} />
        </>
      )}
      <WindowFields {...props} />
    </>
  );
}
