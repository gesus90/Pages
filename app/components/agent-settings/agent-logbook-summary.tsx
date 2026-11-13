import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import {
  AGENT_LOGBOOK_COMPACTION_PERCENT,
  AGENT_LOGBOOK_LIMIT_RANGE,
  AGENT_LOGBOOK_QUIET_RANGE,
} from "@/definition/AgentLogbook";

import {
  DEFAULT_MODEL_KEY,
  logbookModelKey,
} from "./use-logbook-settings-draft";

import type { LogbookSettingsDraft } from "./use-logbook-settings-draft";
import type { AgentLogbookOverview } from "@/definition/AgentLogbook";

function SummaryCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex min-h-36 flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** How full the Lagebuch is: the count, a bar with the mark of the compaction and the rule behind it. */
function FillCard({
  overview,
}: {
  readonly overview: AgentLogbookOverview;
}): React.ReactElement {
  const { t } = useTranslation();
  const isCritical = overview.fillPercent >= AGENT_LOGBOOK_COMPACTION_PERCENT;
  return (
    <SummaryCard title={t("agentLogbook.cards.fill")}>
      <p className="text-3xl font-semibold text-foreground tabular-nums">
        {t("agentLogbook.fill.count", {
          count: overview.count,
          limit: overview.settings.limit,
        })}
      </p>
      <div
        aria-label={t("agentLogbook.fill.meter")}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={overview.fillPercent}
        aria-valuetext={`${String(overview.fillPercent)} %`}
        className="relative h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
      >
        <div
          className={cn(
            "h-full rounded-full",
            isCritical ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${String(overview.fillPercent)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("agentLogbook.fill.hint", {
          percent: AGENT_LOGBOOK_COMPACTION_PERCENT,
        })}
      </p>
    </SummaryCard>
  );
}

interface NumberFieldProps {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly text: string;
  readonly range: { readonly minimum: number; readonly maximum: number };
  readonly problem: string | null;
  readonly isReadOnly: boolean;
  readonly onChange: (text: string) => void;
}

/** One number entry with its unit and its problem. */
function NumberField({
  id,
  label,
  unit,
  text,
  range,
  problem,
  isReadOnly,
  onChange,
}: NumberFieldProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          aria-describedby={problem === null ? undefined : `${id}-problem`}
          aria-invalid={problem !== null}
          className="w-24"
          id={id}
          inputMode="numeric"
          max={range.maximum}
          min={range.minimum}
          onChange={(event) => onChange(event.currentTarget.value)}
          readOnly={isReadOnly}
          step={1}
          type="number"
          value={text}
        />
        <span className="text-sm text-foreground">{unit}</span>
      </div>
      {problem === null ? null : (
        <p
          className="text-xs text-destructive"
          id={`${id}-problem`}
          role="alert"
        >
          {problem}
        </p>
      )}
    </div>
  );
}

function LimitCard({
  draft,
  isReadOnly,
}: {
  readonly draft: LogbookSettingsDraft;
  readonly isReadOnly: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <SummaryCard title={t("agentLogbook.cards.limit")}>
      <NumberField
        id="agent-logbook-limit"
        label={t("agentLogbook.settings.limitLabel")}
        unit={t("agentLogbook.settings.limitUnit")}
        text={draft.limitText}
        range={AGENT_LOGBOOK_LIMIT_RANGE}
        problem={
          draft.hasLimitProblem
            ? t("agentLogbook.settings.limitInvalid", {
                ...AGENT_LOGBOOK_LIMIT_RANGE,
              })
            : null
        }
        isReadOnly={isReadOnly}
        onChange={draft.setLimitText}
      />
      <p className="text-xs text-muted-foreground">
        {isReadOnly
          ? t("agentLogbook.settings.readOnly")
          : t("agentLogbook.settings.limitHint")}
      </p>
    </SummaryCard>
  );
}

/** The options of the model choice: the default first, then every model the administrator may choose. */
function modelOptions(
  overview: AgentLogbookOverview,
  t: ReturnType<typeof useTranslation>["t"],
): { readonly value: string; readonly label: string }[] {
  const { instanceModel, models, settings } = overview;
  const standard = {
    value: DEFAULT_MODEL_KEY,
    label:
      instanceModel === null
        ? t("agentLogbook.settings.modelAgent")
        : t("agentLogbook.settings.modelInstance", { name: instanceModel.label }),
  };
  const options = models.map((model) => ({
    value: logbookModelKey(model),
    label: model.label,
  }));
  // A saved model the choice no longer lists stays visible until another is chosen.
  const saved = settings.model;
  const isListed =
    saved === null ||
    options.some((option) => option.value === logbookModelKey(saved));
  return [
    standard,
    ...(isListed || saved === null
      ? []
      : [{ value: logbookModelKey(saved), label: saved.model }]),
    ...options,
  ];
}

function SummaryRunCard({
  overview,
  draft,
  isReadOnly,
}: {
  readonly overview: AgentLogbookOverview;
  readonly draft: LogbookSettingsDraft;
  readonly isReadOnly: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const options = modelOptions(overview, t);
  const current =
    options.find((option) => option.value === draft.modelKey) ?? options[0];
  return (
    <SummaryCard title={t("agentLogbook.cards.summary")}>
      <div className="flex flex-wrap gap-4">
        <NumberField
          id="agent-logbook-quiet"
          label={t("agentLogbook.settings.quietLabel")}
          unit={t("agentLogbook.settings.quietUnit")}
          text={draft.quietText}
          range={AGENT_LOGBOOK_QUIET_RANGE}
          problem={
            draft.hasQuietProblem
              ? t("agentLogbook.settings.quietInvalid", {
                  ...AGENT_LOGBOOK_QUIET_RANGE,
                })
              : null
          }
          isReadOnly={isReadOnly}
          onChange={draft.setQuietText}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label
            className="text-xs text-muted-foreground"
            htmlFor="agent-logbook-model"
          >
            {t("agentLogbook.settings.modelLabel")}
          </label>
          {isReadOnly ? (
            <p
              className="text-sm text-foreground"
              id="agent-logbook-model"
            >
              {current?.label}
            </p>
          ) : (
            <Select
              ariaLabel={t("agentLogbook.settings.modelLabel")}
              className="w-full"
              id="agent-logbook-model"
              onValueChange={draft.setModelKey}
              options={options}
              value={draft.modelKey}
            />
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("agentLogbook.settings.quietHint")}
      </p>
    </SummaryCard>
  );
}

/**
 * The three cards above the list of entries: how full the Lagebuch is, its
 * limit, and when and with which model a quiet chat is summarized.
 */
export function AgentLogbookSummary({
  overview,
  draft,
}: {
  readonly overview: AgentLogbookOverview;
  readonly draft: LogbookSettingsDraft;
}): React.ReactElement {
  const isReadOnly = !overview.canChangeSettings;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <FillCard overview={overview} />
      <LimitCard draft={draft} isReadOnly={isReadOnly} />
      <SummaryRunCard
        overview={overview}
        draft={draft}
        isReadOnly={isReadOnly}
      />
    </div>
  );
}
