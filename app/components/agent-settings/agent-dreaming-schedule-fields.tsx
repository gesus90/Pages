import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  AGENT_DREAM_INTERVAL_RANGE,
  AGENT_DREAM_INTERVAL_UNITS,
  AGENT_DREAM_WEEKDAY_RANGE,
} from "@/definition/AgentDreaming";

import type { DreamScheduleDraft } from "./use-dream-schedule-draft";

interface DreamFieldProps {
  readonly draft: DreamScheduleDraft;
  /** Whether the viewer may not change the schedule. */
  readonly isReadOnly: boolean;
}

const WEEKDAYS = Array.from(
  { length: AGENT_DREAM_WEEKDAY_RANGE.maximum },
  (_, index) => String(AGENT_DREAM_WEEKDAY_RANGE.minimum + index),
);

/** "alle [6] [Stunden]": the interval as a number and its unit. */
export function IntervalField({
  draft,
  isReadOnly,
}: DreamFieldProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { fields } = draft;
  const range = AGENT_DREAM_INTERVAL_RANGE[fields.unit];
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-xs text-muted-foreground"
        htmlFor={`${id}-interval`}
      >
        {t("agentDreaming.schedule.intervalLabel")}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-foreground">
          {t("agentDreaming.schedule.every")}
        </span>
        <Input
          aria-describedby={
            draft.hasIntervalProblem ? `${id}-problem` : undefined
          }
          aria-invalid={draft.hasIntervalProblem}
          className="w-24"
          disabled={isReadOnly}
          id={`${id}-interval`}
          inputMode="numeric"
          max={range.maximum}
          min={range.minimum}
          onChange={(event) =>
            draft.update({ intervalText: event.currentTarget.value })
          }
          step={1}
          type="number"
          value={fields.intervalText}
        />
        <Select
          ariaLabel={t("agentDreaming.schedule.unitLabel")}
          className="w-32"
          disabled={isReadOnly}
          onValueChange={draft.setUnit}
          options={AGENT_DREAM_INTERVAL_UNITS.map((unit) => ({
            value: unit,
            label: t(`agentDreaming.schedule.unit.${unit}`),
          }))}
          value={fields.unit}
        />
      </div>
      {draft.hasIntervalProblem ? (
        <p
          className="text-xs text-destructive"
          id={`${id}-problem`}
          role="alert"
        >
          {t("agentDreaming.schedule.intervalInvalid", { ...range })}
        </p>
      ) : null}
    </div>
  );
}

/** The time of day of a schedule in days; empty follows the time of the instance. */
export function TimeField({
  draft,
  isReadOnly,
  instanceTime,
}: DreamFieldProps & { readonly instanceTime: string }): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { time } = draft.fields;
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {t("agentDreaming.schedule.timeLabel")}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-32"
          disabled={isReadOnly}
          id={id}
          onChange={(event) =>
            draft.update({ time: event.currentTarget.value })
          }
          type="time"
          value={time}
        />
        {time === "" || isReadOnly ? null : (
          <Button
            onClick={() => draft.update({ time: "" })}
            size="sm"
            variant="link"
          >
            {t("agentDreaming.schedule.timeInstanceUse")}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("agentDreaming.schedule.timeHint", { time: instanceTime })}
      </p>
    </div>
  );
}

/** "Kein Wochentag" or Monday to Sunday, for a schedule of 7 days. */
export function WeekdayField({
  draft,
  isReadOnly,
}: DreamFieldProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {t("agentDreaming.schedule.weekdayLabel")}
      </label>
      <Select
        ariaLabel={t("agentDreaming.schedule.weekdayLabel")}
        className="w-48"
        disabled={isReadOnly}
        id={id}
        onValueChange={(weekday) => draft.update({ weekday })}
        options={[
          { value: "", label: t("agentDreaming.schedule.weekdayNone") },
          ...WEEKDAYS.map((weekday) => ({
            value: weekday,
            label: t(`agentDreaming.weekday.${weekday}`),
          })),
        ]}
        value={draft.fields.weekday}
      />
    </div>
  );
}
