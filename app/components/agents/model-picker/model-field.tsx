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
 * A closed field whose whole surface is the badge of its value, as in the
 * footer of an agent node: 40 px high, 12 px radius, one solid 1 px border,
 * text 12/600.
 * @remarks
 * The value adds its own border color on the surface, such as the vendor
 * color or the dot color of a reasoning level; there is no inner field and
 * no second border, and hovering only lightens the background slightly. A
 * 28 px tile, or the place of a reasoning sign, stands 5 px from the left,
 * top and bottom edge, so the 12 px radius equals the tile's 6 px radius,
 * the 5 px gap and the 1 px border. The text follows 6 px after it on one
 * line, cut with an ellipsis, and the 12 px arrow 7 px from the right edge
 * with `ml-auto`, so the arrow keeps its place whatever the value says and
 * a value never grows the field.
 */
export const MODEL_BADGE_FIELD_CLASS =
  "flex h-10 w-full min-w-0 items-center justify-start gap-1.5 rounded-lg border bg-surface py-0 pr-[7px] pl-[5px] text-left text-xs leading-none font-semibold text-foreground outline-none transition enabled:hover:brightness-105 focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

/**
 * A value of a {@link MODEL_BADGE_FIELD_CLASS} field without a tile, such as
 * a missing model or the default level: one line, cut with an ellipsis, 7 px
 * from the left edge like the arrow from the right one.
 */
export const MODEL_BADGE_FIELD_TEXT_CLASS = "min-w-0 truncate pl-[7px]";

/** The arrow of a {@link MODEL_BADGE_FIELD_CLASS} field: 12 px with a 1.8 px stroke, pushed to the right edge. */
export const MODEL_BADGE_FIELD_ARROW_CLASS =
  "ml-auto size-3 shrink-0 stroke-[1.8]";

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
