import { useId } from "react";
import { useTranslation } from "react-i18next";

import { ModelChoiceBadge } from "@/app/components/agents/badges/model-choice-badge";
import { ReasoningBadge } from "@/app/components/agents/badges/reasoning-badge";
import { MODEL_BADGE_FIELD_CLASS } from "@/app/components/agents/model-picker/model-field";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";

import type { ReasoningSelectOptions } from "@/app/lib/reasoning-options";

/** The dash of a level field whose model offers no level to choose. */
const NO_LEVEL = "–";

/**
 * What the closed reasoning field shows: the level's badge, the default as
 * quiet text, or a dash while the model offers no level.
 * @remarks
 * A saved level stays visible as its badge even when it cannot be chosen,
 * marked as not offered, so an unsupported choice never disappears.
 */
function ReasoningValue(props: {
  readonly value: string;
  readonly options: ReasoningSelectOptions;
  readonly hasLevels: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.value === "")
    return (
      <span className="min-w-0 truncate text-muted-foreground">
        {props.hasLevels ? t("pageAgents.defaultReasoning") : NO_LEVEL}
      </span>
    );
  const option = props.options.find((entry) => entry.value === props.value);
  return (
    <ReasoningBadge
      level={props.value}
      isOffered={option?.disabled === true ? false : null}
    />
  );
}

/**
 * The reasoning level of an agent node's footer as a fixed field with the
 * level's badge.
 * @remarks
 * The field has the measures of the model field beside it; choosing another
 * level changes only the badge, never the field or the arrow. Without a
 * level to choose the field stays, greyed out with a dash.
 */
export function PlanReasoningField(props: {
  readonly value: string;
  readonly options: ReasoningSelectOptions;
  readonly onChange: (effort: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = `${useId()}-reasoning`;
  const label = t("pageAgents.reasoning");
  const hasLevels = props.options.some(
    (option) => option.value !== "" && option.disabled !== true,
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
        options={props.options}
        disabled={!hasLevels}
        className={cn(
          MODEL_BADGE_FIELD_CLASS,
          "[&>span]:flex [&>span]:min-w-0 [&>svg]:ml-auto [&>svg]:size-4",
        )}
        valueContent={
          <ReasoningValue
            value={props.value}
            options={props.options}
            hasLevels={hasLevels}
          />
        }
        onValueChange={props.onChange}
      />
    </div>
  );
}

/**
 * The model of an agent node's footer, read only, in the same fixed field
 * as the choice.
 * @remarks
 * A model that is not offered any more is a short warning; the saved name
 * and the reason stay in the tooltip.
 */
export function PlanModelValue(props: {
  readonly choice: { readonly mark: string; readonly name: string } | null;
  readonly savedModel: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = t("pageAgents.model");
  if (!props.choice) {
    const saved = props.savedModel ? `: ${props.savedModel}` : "";
    return (
      <p
        className={cn(MODEL_BADGE_FIELD_CLASS, "hover:bg-surface")}
        title={`${label}${saved} · ${t("pageAgents.missingModel")}`}
      >
        <span className="sr-only">{label}: </span>
        <span className="min-w-0 truncate text-warning">
          {t("pageAgents.modelMissingShort")}
        </span>
      </p>
    );
  }
  return (
    <p className={cn(MODEL_BADGE_FIELD_CLASS, "hover:bg-surface")}>
      <span className="sr-only">{label}: </span>
      <ModelChoiceBadge mark={props.choice.mark} name={props.choice.name} />
    </p>
  );
}

/** The reasoning level of an agent node's footer, read only, in the same fixed field. */
export function PlanReasoningValue(props: {
  readonly reasoning: string | null;
  readonly hasLevels: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p className={cn(MODEL_BADGE_FIELD_CLASS, "hover:bg-surface")}>
      <span className="sr-only">{t("pageAgents.reasoning")}: </span>
      <ReasoningValue
        value={props.reasoning ?? ""}
        options={[]}
        hasLevels={props.hasLevels}
      />
    </p>
  );
}
