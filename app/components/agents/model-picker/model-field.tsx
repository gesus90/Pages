import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";

import type { ReasoningSelectOptions } from "@/app/lib/reasoning-options";

/*
 * The fixed measures of the model choice, the same in settings,
 * dialogs and plan cards: no container or breakpoint enlarges them.
 */

/** A field label: 14 px on a 20 px line, medium weight, 6 px above its field. */
export const MODEL_FIELD_LABEL_CLASS =
  "mb-1.5 block text-sm leading-5 font-medium text-foreground";

/** A closed field and the search field: 40 px high, 10 px radius, 14 px text, 12 px padding. */
export const MODEL_FIELD_CLASS =
  "h-10 w-full rounded-[10px] bg-surface px-3 text-sm text-foreground shadow-field outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

/**
 * A closed field that names its value by a badge, as in the footer of an
 * agent node: 40 px high, 10 px radius, 1 px border, 8 px padding on the
 * left and 10 px on the right.
 * @remarks
 * The badge stands left with `min-w-0`, the 16 px arrow right with
 * `ml-auto` and 4 px between them, so the arrow keeps its place whatever the
 * badge says and a badge never grows the field. The 1 px edge is an inset
 * ring that takes no room, so a badge gets 105 px in a 143 px field and
 * 100 px in a 138 px field.
 */
export const MODEL_BADGE_FIELD_CLASS =
  "flex h-10 w-full min-w-0 items-center justify-start gap-1 rounded-[10px] bg-surface pr-2.5 pl-2 text-left text-sm font-normal text-foreground shadow-field inset-ring inset-ring-field-border outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

/** The arrow of a {@link MODEL_BADGE_FIELD_CLASS} field: 16 px, pushed to the right edge. */
export const MODEL_BADGE_FIELD_ARROW_CLASS =
  "ml-auto size-4 shrink-0 text-muted-foreground";

/**
 * Lays out the model and the reasoning field side by side.
 * @remarks
 * Both columns are equally wide and start at the same top, so the labels
 * and the fields of the two choices stand flush in every place.
 */
export function ModelFieldRow({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid min-w-0 grid-cols-2 items-start gap-3">{children}</div>
  );
}

/**
 * The reasoning level of the chosen model, styled like the model choice beside it.
 * @remarks
 * The options come from {@link reasoningOptions}: the levels the chosen model
 * supports, and levels it lacks listed but disabled, as before.
 */
export function ReasoningField(props: {
  readonly value: string;
  readonly options: ReasoningSelectOptions;
  readonly disabled: boolean;
  readonly onChange: (effort: string) => void;
  /** Keeps the label for assistive technology only, as in a plan card. */
  readonly isLabelHidden?: boolean;
  /** A short remark below the field, such as a model without levels. */
  readonly note?: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = `${useId()}-reasoning`;
  const label = t("pageAgents.reasoning");
  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className={props.isLabelHidden ? "sr-only" : MODEL_FIELD_LABEL_CLASS}
      >
        {label}
      </label>
      <Select
        id={id}
        ariaLabel={label}
        value={props.value}
        options={props.options}
        disabled={
          props.disabled ||
          !props.options.some(
            (option) => option.value !== "" && !option.disabled,
          )
        }
        className={cn(
          MODEL_FIELD_CLASS,
          "font-normal hover:bg-surface-hover [&>span]:min-w-0 [&>span]:truncate [&>svg]:size-4",
        )}
        onValueChange={props.onChange}
      />
      {props.note ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{props.note}</p>
      ) : null}
    </div>
  );
}
