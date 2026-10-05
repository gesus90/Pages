import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getLabelTextColor } from "@/app/components/tasks/label-color";
import { cn } from "@/app/lib/cn";
import { LABEL_COLORS } from "@/definition/Task";

interface LabelColorPresetsProps {
  readonly activeColor: string;
  readonly onSelect: (color: string) => void;
}

/**
 * Renders the preset swatches with the current color marked.
 *
 * @remarks
 * A color outside the presets gets its own dashed swatch, so the current
 * value is always visible.
 */
export function LabelColorPresets({
  activeColor,
  onSelect,
}: LabelColorPresetsProps): React.ReactElement {
  const { t } = useTranslation();

  const isPresetActive = LABEL_COLORS.some(
    (preset) => preset.toLowerCase() === activeColor,
  );

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="radiogroup"
      aria-label={t("tasks.labels.color")}
    >
      {LABEL_COLORS.map((preset) => {
        const isActive = preset.toLowerCase() === activeColor;
        const checkIsWhite = getLabelTextColor(preset) === preset;

        return (
          <button
            key={preset}
            aria-label={preset}
            aria-pressed={isActive}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-full transition-transform",
              isActive
                ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-surface"
                : "ring-1 ring-black/10 hover:scale-105",
            )}
            onClick={() => onSelect(preset)}
            style={{ backgroundColor: preset }}
            title={preset.toUpperCase()}
            type="button"
          >
            {isActive ? (
              <Check
                className={cn(
                  "size-3.5",
                  checkIsWhite
                    ? "text-white drop-shadow-[0_1px_1px_rgb(0_0_0/60%)]"
                    : "text-[#44403c]",
                )}
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
      })}
      {!isPresetActive ? (
        <span
          className="inline-flex size-7 items-center justify-center rounded-full ring-2 ring-dashed ring-foreground/60 ring-offset-2 ring-offset-surface"
          style={{ backgroundColor: activeColor }}
          title={`${t("tasks.labels.currentColor")}: ${activeColor.toUpperCase()}`}
        />
      ) : null}
    </div>
  );
}
