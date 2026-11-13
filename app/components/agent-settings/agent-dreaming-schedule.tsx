import { useId } from "react";
import { useTranslation } from "react-i18next";

import { AutomationSwitch } from "@/app/components/automations/automation-switch";
import { Select } from "@/app/components/ui/select";

import {
  describeDreamSchedule,
  dreamModelOptions,
} from "./agent-dreaming-display";
import {
  IntervalField,
  TimeField,
  WeekdayField,
} from "./agent-dreaming-schedule-fields";
import { DreamCard } from "./agent-dreaming-widgets";

import type { DreamScheduleDraft } from "./use-dream-schedule-draft";
import type { AgentDreamingOverview } from "@/definition/AgentDreaming";

interface SwitchRowProps {
  readonly label: string;
  readonly description: string;
  readonly isChecked: boolean;
  readonly isDisabled: boolean;
  readonly onChange: () => void;
}

/** A switch with its label and an explanation under it. */
function SwitchRow({
  label,
  description,
  isChecked,
  isDisabled,
  onChange,
}: SwitchRowProps): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <AutomationSwitch
        checked={isChecked}
        disabled={isDisabled}
        label={label}
        onChange={onChange}
      />
    </div>
  );
}

/** "Modell für Dreaming": the agent's own model first, then the models the administrator may choose. */
function ModelField({
  overview,
  draft,
  isReadOnly,
}: {
  readonly overview: AgentDreamingOverview;
  readonly draft: DreamScheduleDraft;
  readonly isReadOnly: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {t("agentDreaming.schedule.modelLabel")}
      </label>
      <Select
        ariaLabel={t("agentDreaming.schedule.modelLabel")}
        className="w-full"
        disabled={isReadOnly}
        id={id}
        onValueChange={(modelKey) => draft.update({ modelKey })}
        options={dreamModelOptions(overview, t)}
        value={draft.fields.modelKey}
      />
    </div>
  );
}

/** The schedule of the draft in words, and the trigger of the Lagebuch. */
function ScheduleSummary({
  overview,
  draft,
}: {
  readonly overview: AgentDreamingOverview;
  readonly draft: DreamScheduleDraft;
}): React.ReactElement {
  const { t } = useTranslation();
  const schedule = draft.settings?.schedule ?? null;
  return (
    <div
      aria-live="polite"
      className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2 text-sm"
    >
      <p>
        <span className="text-muted-foreground">
          {t("agentDreaming.summary.label")}{" "}
        </span>
        <span className="font-medium text-foreground">
          {schedule === null
            ? t("agentDreaming.summary.invalid")
            : describeDreamSchedule(schedule, overview.instanceTime, t)}
        </span>
      </p>
      {schedule?.isEnabled === true && schedule.isOnFullLogbook ? (
        <p className="text-xs text-muted-foreground">
          {t("agentDreaming.summary.onFullLogbook", {
            percent: overview.logbook.triggerPercent,
          })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The card "Zeitplan": on or off, the interval in hours or days, the time of
 * day and the weekday where they make sense, the trigger of a full Lagebuch,
 * the model, and the schedule in words.
 */
export function AgentDreamingSchedule({
  overview,
  draft,
}: {
  readonly overview: AgentDreamingOverview;
  readonly draft: DreamScheduleDraft;
}): React.ReactElement {
  const { t } = useTranslation();
  const isReadOnly = !overview.canChange;
  const { fields } = draft;
  const { fillPercent, triggerPercent } = overview.logbook;
  return (
    <DreamCard title={t("agentDreaming.cards.schedule")}>
      {isReadOnly ? (
        <p className="text-xs text-muted-foreground" role="note">
          {t("agentDreaming.readOnly")}
        </p>
      ) : null}
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <SwitchRow
            label={t("agentDreaming.schedule.enabled")}
            description={t("agentDreaming.schedule.enabledHint")}
            isChecked={fields.isEnabled}
            isDisabled={isReadOnly}
            onChange={() => draft.update({ isEnabled: !fields.isEnabled })}
          />
          <IntervalField draft={draft} isReadOnly={isReadOnly} />
          {fields.unit === "days" ? (
            <TimeField
              draft={draft}
              isReadOnly={isReadOnly}
              instanceTime={overview.instanceTime}
            />
          ) : null}
          {draft.hasWeekdayChoice ? (
            <WeekdayField draft={draft} isReadOnly={isReadOnly} />
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <SwitchRow
            label={t("agentDreaming.schedule.onFullLogbook")}
            description={t("agentDreaming.schedule.logbookFill", {
              fill: fillPercent,
              trigger: triggerPercent,
            })}
            isChecked={fields.isOnFullLogbook}
            isDisabled={isReadOnly}
            onChange={() =>
              draft.update({ isOnFullLogbook: !fields.isOnFullLogbook })
            }
          />
          <ModelField
            overview={overview}
            draft={draft}
            isReadOnly={isReadOnly}
          />
          <ScheduleSummary overview={overview} draft={draft} />
        </div>
      </div>
    </DreamCard>
  );
}
