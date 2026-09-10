import { Check, Pipette } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { HexagonColorPicker } from "@/app/components/tasks/hexagon-color-picker";
import { getLabelTextColor } from "@/app/components/tasks/label-color";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";
import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLORS,
  normalizeHexColorCode,
} from "@/definition/Task";

interface LabelEditorProps {
  readonly name: string;
  readonly color: string;
  readonly isSaving?: boolean;
  readonly canSave: boolean;
  readonly saveLabel: string;
  readonly onNameChange: (name: string) => void;
  readonly onColorChange: (color: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/**
 * Renders the shared name-and-color form for creating and editing labels.
 *
 * @remarks
 * Create and edit flows share this surface so presets, the free picker, and
 * the live preview never drift apart: quick preset swatches with a clear
 * current-color mark, an expandable hexagon picker for arbitrary hex colors,
 * and a preview pill using the Pages label geometry with readable text.
 */
export function LabelEditor({
  name,
  color,
  isSaving = false,
  canSave,
  saveLabel,
  onNameChange,
  onColorChange,
  onSave,
  onCancel,
}: LabelEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const [isCustomOpen, setIsCustomOpen] = useState(false);

  const normalizedColor = normalizeHexColorCode(color) ?? DEFAULT_LABEL_COLOR;
  const presetMatch = (LABEL_COLORS as readonly string[]).some(
    (preset) => preset.toLowerCase() === normalizedColor,
  );
  const previewName = name.trim() || t("tasks.labels.namePlaceholder");
  const previewText = getLabelTextColor(normalizedColor);

  function handlePresetSelect(preset: string): void {
    onColorChange(preset);
  }

  function handleNameKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === "Enter" && canSave && !isSaving) {
      event.preventDefault();
      onSave();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Input
          aria-label={t("tasks.labels.name")}
          autoFocus
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={handleNameKeyDown}
          placeholder={t("tasks.labels.namePlaceholder")}
          value={name}
        />
        <div
          aria-label={t("tasks.labels.preview")}
          className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2"
          role="status"
        >
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
            {t("tasks.labels.preview")}
          </span>
          <span
            className="inline-flex max-w-full items-center gap-1 truncate rounded-md px-2 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: `${normalizedColor}26`,
              color: previewText,
            }}
          >
            <span className="min-w-0 truncate">{previewName}</span>
          </span>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5"
        role="radiogroup"
        aria-label={t("tasks.labels.color")}
      >
        {LABEL_COLORS.map((preset) => {
          const isActive = preset.toLowerCase() === normalizedColor;
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
              onClick={() => handlePresetSelect(preset)}
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
        {!presetMatch ? (
          <span
            className="inline-flex size-7 items-center justify-center rounded-full ring-2 ring-dashed ring-foreground/60 ring-offset-2 ring-offset-surface"
            style={{ backgroundColor: normalizedColor }}
            title={`${t("tasks.labels.currentColor")}: ${normalizedColor.toUpperCase()}`}
          />
        ) : null}
      </div>

      <div>
        <Button
          className="h-8 gap-1.5 px-3 text-xs"
          onClick={() => setIsCustomOpen((previous) => !previous)}
          type="button"
          variant="outline"
          aria-expanded={isCustomOpen}
        >
          <Pipette className="size-3.5" aria-hidden="true" />
          {t("tasks.labels.customColor")}
        </Button>

        {isCustomOpen ? (
          <div className="mt-3 rounded-xl bg-muted/40 p-3">
            <HexagonColorPicker
              color={normalizedColor}
              onChange={onColorChange}
            />
          </div>
        ) : null}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          className="h-8 px-3 text-xs"
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          {t("tasks.actions.cancel")}
        </Button>
        <Button
          className="h-8 px-3 text-xs"
          disabled={isSaving || !canSave}
          onClick={onSave}
          type="button"
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
