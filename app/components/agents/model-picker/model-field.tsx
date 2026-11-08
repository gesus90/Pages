import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";

import type { ReasoningSelectOptions } from "@/app/lib/reasoning-options";

/*
 * The fixed measures of the model choice (PAGE-248), the same in settings,
 * dialogs and plan cards: no container or breakpoint enlarges them.
 */

/** A field label: 14 px on a 20 px line, medium weight, 6 px above its field. */
export const MODEL_FIELD_LABEL_CLASS =
  "mb-1.5 block text-sm leading-5 font-medium text-foreground";

/** A closed field and the search field: 40 px high, 10 px radius, 14 px text, 12 px padding. */
export const MODEL_FIELD_CLASS =
  "h-10 w-full rounded-[10px] bg-surface px-3 text-sm text-foreground shadow-field outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Lays out the model and the reasoning field side by side.
 *
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
 *
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
        disabled={props.disabled || props.options.length === 1}
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
