import { useId } from "react";
import { useTranslation } from "react-i18next";

import {
  ModelChoiceBadge,
  modelChoiceFieldClass,
} from "@/app/components/agents/badges/model-choice-badge";
import {
  REASONING_LEVEL_CLASSES,
  ReasoningTile,
  reasoningSignLevel,
} from "@/app/components/agents/badges/reasoning-sign";
import {
  MODEL_BADGE_FIELD_CLASS,
  MODEL_BADGE_FIELD_TEXT_CLASS,
} from "@/app/components/agents/model-picker/model-field";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import {
  REASONING_BADGE_LEVELS,
  isReasoningBadgeLevel,
} from "@/definition/AgentModelIdentity";

import type { ReasoningSelectOptions } from "@/app/lib/reasoning-options";
import type { TFunction } from "i18next";

/** The dash of a level field whose model offers no level to choose. */
const NO_LEVEL = "–";

/**
 * The arrow of the level choice: 12 px with a 1.8 px stroke at the right
 * edge, in the level's color at 75 %, and the value beside it on one line.
 */
const REASONING_TRIGGER_CLASS =
  "[&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>svg]:ml-auto [&>svg]:size-3 [&>svg]:stroke-[1.8] [&>svg]:text-current [&>svg]:opacity-75";

/**
 * The open level choice: 200 px wide and at least as wide as the field,
 * 12 px radius, a 1 px border and 4 px padding.
 */
const REASONING_MENU_CLASS =
  "w-[200px] min-w-(--radix-select-trigger-width) rounded-xl border border-border p-0";

/**
 * A row of the open level choice: 36 px high, 8 px radius, the 24 px tile
 * 8 px before the word in 13/500; the check of the chosen row takes the
 * level's color.
 */
const REASONING_ROW_CLASS =
  "h-9 min-h-9 gap-2 rounded-lg px-1.5 py-0 text-[13px] font-medium [&_svg]:text-current";

/** The word of a reasoning level, such as `hoch`; an unknown level keeps its raw name. */
function levelWord(level: string, t: TFunction): string {
  return isReasoningBadgeLevel(level)
    ? t(`agentBadges.reasoning.level.${level}`)
    : level;
}

/**
 * The border, background and text of a level field: the colors of the
 * level, or the neutral field for the default and the dash.
 */
function reasoningFieldClass(value: string): string {
  if (value === "") return "border-field-border bg-surface";
  const classes = REASONING_LEVEL_CLASSES[reasoningSignLevel(value)];
  return cn(classes.badge, classes.fieldHover);
}

/**
 * A saved level inside its field: the 28 px tile with the level's sign and
 * the word; a level the model does not offer adds a warning sign and says
 * so in the tooltip.
 */
function ReasoningLevelValue(props: {
  readonly level: string;
  readonly isOffered: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const signLevel = reasoningSignLevel(props.level);
  const word = levelWord(props.level, t);
  const notOffered = t("agentBadges.reasoning.notOffered");
  return (
    <span
      title={props.isOffered ? word : `${word} · ${notOffered}`}
      data-reasoning-badge={
        isReasoningBadgeLevel(props.level) ? props.level : "unknown"
      }
      className="flex min-w-0 flex-1 items-center gap-1.5"
    >
      <ReasoningTile
        level={signLevel}
        className="size-7 rounded-[6px]"
        signClassName="size-4"
      />
      <span className="min-w-0 truncate">{word}</span>
      {props.isOffered ? null : (
        <>
          <span aria-hidden="true" className="shrink-0">
            ⚠
          </span>
          <span className="sr-only">{`, ${notOffered}`}</span>
        </>
      )}
    </span>
  );
}

/**
 * What the closed reasoning field shows: the level with its tile, the
 * default as quiet text, or a dash while the model offers no level.
 * @remarks
 * A saved level stays visible even when it cannot be chosen, marked as not
 * offered, so an unsupported choice never disappears.
 */
function ReasoningValue(props: {
  readonly value: string;
  readonly options: ReasoningSelectOptions;
  readonly hasLevels: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.value === "")
    return (
      <span
        className={cn(MODEL_BADGE_FIELD_TEXT_CLASS, "text-muted-foreground")}
      >
        {props.hasLevels ? t("pageAgents.defaultReasoning") : NO_LEVEL}
      </span>
    );
  const option = props.options.find((entry) => entry.value === props.value);
  return (
    <ReasoningLevelValue
      level={props.value}
      isOffered={option?.disabled !== true}
    />
  );
}

/** The levels a model offers to choose, from the options of its field. */
function offeredLevels(options: ReasoningSelectOptions): readonly string[] {
  return options
    .filter((option) => option.value !== "" && option.disabled !== true)
    .map((option) => option.value);
}

/** Where a level stands in the choice: from the least effort, unknown levels last. */
function levelRank(level: string): number {
  const rank = (REASONING_BADGE_LEVELS as readonly string[]).indexOf(level);
  return rank === -1 ? REASONING_BADGE_LEVELS.length : rank;
}

/**
 * The rows of the open level choice: only the levels the model offers, from
 * the least effort, each with its tile and word and the colors of the level
 * while it is the chosen one.
 */
function levelMenuOptions(
  levels: readonly string[],
  t: TFunction,
): ReasoningSelectOptions {
  return [...levels]
    .sort((first, second) => levelRank(first) - levelRank(second))
    .map((level) => {
      const signLevel = reasoningSignLevel(level);
      return {
        value: level,
        label: levelWord(level, t),
        icon: (
          <ReasoningTile
            level={signLevel}
            className="size-6 rounded-[6px]"
            signClassName="size-4"
          />
        ),
        className: cn(
          REASONING_ROW_CLASS,
          REASONING_LEVEL_CLASSES[signLevel].chosenRow,
        ),
      };
    });
}

/**
 * What a level field without a choice shows: the saved level, the one level
 * the model offers, or a dash.
 */
function fixedLevel(value: string, levels: readonly string[]): string {
  const [onlyLevel] = levels;
  return value === "" && onlyLevel !== undefined ? onlyLevel : value;
}

/**
 * The level field without an arrow, for a model with one level or none.
 * @remarks
 * It keeps the measures of the field. One level stands with its tile;
 * without a level the field is greyed out with a dash.
 */
function FixedReasoningField(props: {
  readonly value: string;
  readonly options: ReasoningSelectOptions;
  readonly levels: readonly string[];
}): React.ReactElement {
  const { t } = useTranslation();
  const value = fixedLevel(props.value, props.levels);
  return (
    <p
      className={cn(
        MODEL_BADGE_FIELD_CLASS,
        reasoningFieldClass(value),
        props.levels.length === 0 && "opacity-60",
      )}
    >
      <span className="sr-only">{t("pageAgents.reasoning")}: </span>
      <ReasoningValue value={value} options={props.options} hasLevels={false} />
    </p>
  );
}

/**
 * The reasoning level of an agent node's footer as a field whose whole
 * surface is the level's badge.
 * @remarks
 * The field has the measures of the model field beside it; choosing another
 * level changes only tile, sign, colors and word, never the field or the
 * arrow. The open choice lists only the levels the model's catalog entry
 * offers. A model with a single level shows it without an arrow, a model
 * without levels a greyed dash without an arrow; a saved level the single
 * level replaces keeps the choice, so it can be corrected.
 */
export function PlanReasoningField(props: {
  readonly value: string;
  readonly options: ReasoningSelectOptions;
  readonly onChange: (effort: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = `${useId()}-reasoning`;
  const label = t("pageAgents.reasoning");
  const levels = offeredLevels(props.options);
  const isFixed =
    levels.length === 0 ||
    (levels.length === 1 && (props.value === "" || props.value === levels[0]));
  if (isFixed)
    return (
      <FixedReasoningField
        value={props.value}
        options={props.options}
        levels={levels}
      />
    );
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select
        id={id}
        ariaLabel={label}
        value={props.value}
        options={levelMenuOptions(levels, t)}
        className={cn(
          MODEL_BADGE_FIELD_CLASS,
          "shadow-none",
          reasoningFieldClass(props.value),
          REASONING_TRIGGER_CLASS,
        )}
        contentClassName={REASONING_MENU_CLASS}
        valueContent={
          <ReasoningValue
            value={props.value}
            options={props.options}
            hasLevels
          />
        }
        onValueChange={props.onChange}
      />
    </div>
  );
}

/**
 * The model of an agent node's footer, read only, in the same field as the
 * choice and without an arrow.
 * @remarks
 * A model that is not offered any more is a short warning; the saved name
 * and the reason stay in the tooltip.
 */
export function PlanModelValue(props: {
  readonly choice: {
    readonly mark: string;
    readonly name: string;
    /** The tool the model is listed under, such as `Claude Code`. */
    readonly tool: string;
  } | null;
  readonly savedModel: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = t("pageAgents.model");
  if (!props.choice) {
    const saved = props.savedModel ? `: ${props.savedModel}` : "";
    return (
      <p
        className={cn(MODEL_BADGE_FIELD_CLASS, modelChoiceFieldClass(null))}
        title={`${label}${saved} · ${t("pageAgents.missingModel")}`}
      >
        <span className="sr-only">{label}: </span>
        <span className={cn(MODEL_BADGE_FIELD_TEXT_CLASS, "text-warning")}>
          {t("pageAgents.modelMissingShort")}
        </span>
      </p>
    );
  }
  return (
    <p
      className={cn(
        MODEL_BADGE_FIELD_CLASS,
        modelChoiceFieldClass(props.choice.mark),
      )}
    >
      <span className="sr-only">{label}: </span>
      <ModelChoiceBadge
        mark={props.choice.mark}
        name={props.choice.name}
        tool={props.choice.tool}
      />
    </p>
  );
}

/**
 * The reasoning level of an agent node's footer, read only, in the same
 * field and without an arrow.
 * @remarks
 * Without a saved level, a model with a single level shows that level; a
 * model without levels shows the greyed dash.
 */
export function PlanReasoningValue(props: {
  readonly reasoning: string | null;
  /** The levels the model's catalog entry offers. */
  readonly levels: readonly string[];
}): React.ReactElement {
  const { t } = useTranslation();
  const [onlyLevel] = props.levels;
  const value =
    props.reasoning ?? (props.levels.length === 1 ? (onlyLevel ?? "") : "");
  return (
    <p
      className={cn(
        MODEL_BADGE_FIELD_CLASS,
        reasoningFieldClass(value),
        value === "" && props.levels.length === 0 && "opacity-60",
      )}
    >
      <span className="sr-only">{t("pageAgents.reasoning")}: </span>
      <ReasoningValue
        value={value}
        options={[]}
        hasLevels={props.levels.length > 0}
      />
    </p>
  );
}
