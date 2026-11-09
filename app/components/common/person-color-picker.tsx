import { Ban } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { PERSON_COLORS } from "@/definition/PersonColor";

import type { PersonColor } from "@/definition/PersonColor";

/** The translation key of every palette color, in palette order. */
const COLOR_NAMES: Readonly<Record<PersonColor, string>> = {
  "#f97316": "orange",
  "#ef4444": "red",
  "#ec4899": "pink",
  "#a855f7": "purple",
  "#6366f1": "indigo",
  "#3b82f6": "blue",
  "#06b6d4": "cyan",
  "#14b8a6": "teal",
  "#22c55e": "green",
  "#84cc16": "lime",
  "#eab308": "yellow",
  "#6b7280": "gray",
};

interface PersonColorPickerProps {
  /** The chosen color, or `null` for none. */
  readonly value: string | null;
  readonly onChange: (color: PersonColor | null) => void;
  /** Accessible name of the whole choice. */
  readonly label: string;
  readonly isDisabled?: boolean;
  /** Offers "no color", which returns to the former look. */
  readonly canClear?: boolean;
}

/**
 * The fixed palette of twelve person colors (PAGE-266), as radio buttons.
 *
 * @remarks
 * The chosen swatch gets a ring with a gap, as the avatar ring looks. The
 * swatches are user-chosen colors, so they are drawn directly.
 */
export function PersonColorPicker({
  value,
  onChange,
  label,
  isDisabled = false,
  canClear = false,
}: PersonColorPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const current = value?.toLowerCase() ?? null;
  return (
    <div
      aria-label={label}
      className="flex flex-wrap items-center gap-2"
      role="radiogroup"
    >
      {PERSON_COLORS.map((color) => {
        const isChosen = current === color;
        return (
          <button
            key={color}
            aria-checked={isChosen}
            aria-label={t(`personColor.names.${COLOR_NAMES[color]}`)}
            className={cn(
              "size-5 shrink-0 rounded-full transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
              isChosen
                ? "ring-2 ring-current ring-offset-2 ring-offset-surface"
                : "hover:scale-110",
            )}
            disabled={isDisabled}
            onClick={() => onChange(color)}
            role="radio"
            style={{ backgroundColor: color, color }}
            title={t(`personColor.names.${COLOR_NAMES[color]}`)}
            type="button"
          />
        );
      })}
      {canClear ? (
        <button
          aria-checked={current === null}
          aria-label={t("personColor.none")}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
            current === null &&
              "ring-2 ring-foreground ring-offset-2 ring-offset-surface",
          )}
          disabled={isDisabled}
          onClick={() => onChange(null)}
          role="radio"
          title={t("personColor.none")}
          type="button"
        >
          <Ban aria-hidden="true" className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
