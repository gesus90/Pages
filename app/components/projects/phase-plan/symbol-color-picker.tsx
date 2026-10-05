import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  MilestoneSymbol,
  SYMBOL_OPTIONS,
} from "@/app/components/projects/phase-plan/milestone-symbol";
import { Input } from "@/app/components/ui/input";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { COLOR_PRESETS } from "@/app/lib/phase-plan/plan-colors";
import { normalizeHexColorCode } from "@/definition/Task";

import type { MilestoneIcon } from "@/definition/Task";
import type { ChangeEvent, KeyboardEvent } from "react";

interface SymbolGridProps {
  readonly selectedIcon: MilestoneIcon;
  readonly color: string;
  readonly onSelect: (icon: MilestoneIcon) => void;
}

function SymbolGrid({
  selectedIcon,
  color,
  onSelect,
}: SymbolGridProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <VerticalScrollArea
      className="mt-2"
      viewportClassName="max-h-[14.5rem]"
      contentClassName="pr-1"
    >
      <div className="grid grid-cols-4 gap-1.5">
        {SYMBOL_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={t(`projectDetail.planning.phasePlan.icons.${option}`)}
            aria-pressed={option === selectedIcon}
            className={`flex aspect-square w-full items-center justify-center rounded-lg border outline-none transition focus-visible:ring-2 focus-visible:ring-primary ${
              option === selectedIcon
                ? "border-primary bg-primary-subtle ring-2 ring-primary/30"
                : "border-transparent hover:bg-muted"
            }`}
            style={{ color }}
            onClick={() => onSelect(option)}
          >
            <MilestoneSymbol icon={option} className="size-4 shrink-0" />
          </button>
        ))}
      </div>
    </VerticalScrollArea>
  );
}

interface PresetGridProps {
  readonly selectedHex: string;
  readonly onSelect: (hex: string) => void;
}

function PresetGrid({
  selectedHex,
  onSelect,
}: PresetGridProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-2 grid grid-cols-8 gap-2">
      {COLOR_PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          aria-label={t(
            `projectDetail.planning.phasePlan.presetColors.${preset.key}`,
          )}
          aria-pressed={preset.hex === selectedHex}
          className={`size-4 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
            preset.hex === selectedHex
              ? "ring-2 ring-primary ring-offset-2 ring-offset-surface"
              : "hover:scale-110"
          }`}
          style={{ backgroundColor: preset.hex }}
          onClick={() => onSelect(preset.hex)}
        />
      ))}
    </div>
  );
}

interface SymbolColorPickerProps {
  readonly selectedIcon: MilestoneIcon;
  readonly selectedHex: string;
  readonly initialCustom: string | null;
  readonly onIconChange: (icon: MilestoneIcon) => void;
  readonly onPresetChange: (hex: string) => void;
  readonly onCustomChange: (hex: string | null) => void;
  readonly onClose: () => void;
}

/**
 * Renders the floating symbol and color picker inside the panel header.
 *
 * @remarks
 * Only the symbol grid scrolls; the preset dots and the custom row stay
 * visible so the popover keeps a stable compact height. Every choice only
 * updates the panel draft and the timeline preview; nothing is persisted
 * until the panel is saved.
 */
export function SymbolColorPicker({
  selectedIcon,
  selectedHex,
  initialCustom,
  onIconChange,
  onPresetChange,
  onCustomChange,
  onClose,
}: SymbolColorPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const [hexText, setHexText] = useState(
    normalizeHexColorCode(initialCustom) ?? "",
  );
  const customLabel = t("projectDetail.planning.phasePlan.customColor");

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      onClose();
    }
  }

  function handleHexTextChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextText = event.currentTarget.value;
    const normalized = normalizeHexColorCode(nextText.trim());

    setHexText(nextText);

    if (normalized !== null) {
      onCustomChange(normalized);
    }
  }

  function handleSpectrumChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextHex = event.currentTarget.value;

    setHexText(nextHex);
    onCustomChange(nextHex);
  }

  function handlePresetSelect(hex: string): void {
    setHexText(hex);
    onPresetChange(hex);
  }

  return (
    <>
      <button
        type="button"
        aria-label={t("projectDetail.planning.phasePlan.closePanel")}
        className="fixed inset-0 z-[70] cursor-default"
        onClick={onClose}
      />
      <div
        className="absolute top-full left-0 z-[71] mt-2 w-64 rounded-xl border border-border/60 bg-surface p-3 shadow-panel"
        onKeyDown={handleKeyDown}
        role="presentation"
      >
        <p className="text-xs font-semibold text-muted-foreground select-none">
          {t("projectDetail.planning.phasePlan.symbol")}
        </p>
        <SymbolGrid
          color={selectedHex}
          onSelect={onIconChange}
          selectedIcon={selectedIcon}
        />
        <p className="mt-3 text-xs font-semibold text-muted-foreground select-none">
          {t("projectDetail.planning.phasePlan.color")}
        </p>
        <PresetGrid onSelect={handlePresetSelect} selectedHex={selectedHex} />
        <p className="mt-3 text-xs font-semibold text-muted-foreground select-none">
          {customLabel}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-full border border-border/60"
            style={{ backgroundColor: selectedHex }}
          />
          <input
            type="color"
            value={selectedHex}
            onChange={handleSpectrumChange}
            aria-label={customLabel}
            className="h-7 w-9 shrink-0 cursor-pointer rounded-md border border-border/60 bg-transparent p-0.5"
          />
          <Input
            value={hexText}
            onChange={handleHexTextChange}
            placeholder="#f97316"
            maxLength={7}
            spellCheck={false}
            aria-label={customLabel}
            className="h-7 font-mono text-xs"
          />
        </div>
      </div>
    </>
  );
}
