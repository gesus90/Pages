import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { hexToHsv, hsvToHex } from "@/app/components/tasks/label-color";
import { cn } from "@/app/lib/cn";
import { normalizeHexColorCode } from "@/definition/Task";

import type { HsvColor } from "@/app/components/tasks/label-color";

interface HexagonColorPickerProps {
  readonly color: string;
  readonly onChange: (color: string) => void;
}

interface HexDraft {
  readonly hexDraft: string;
  readonly isHexValid: boolean;
  readonly changeHexDraft: (value: string) => void;
}

interface SaturationPadProps {
  readonly color: string;
  readonly hsv: HsvColor;
  readonly onChange: (color: string) => void;
}

interface HueSliderProps {
  readonly hsv: HsvColor;
  readonly onChange: (color: string) => void;
}

interface HexColorFieldProps {
  readonly color: string;
  readonly onChange: (color: string) => void;
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function useHexDraft(
  color: string,
  onChange: (color: string) => void,
): HexDraft {
  const [hexDraft, setHexDraft] = useState(color.toUpperCase());

  // Sync from external changes (presets, pad, slider), preserving an in-progress invalid draft.
  useEffect(() => {
    const draftNormalized = normalizeHexColorCode(hexDraft.trim());

    if (
      draftNormalized !== null &&
      draftNormalized !== normalizeHexColorCode(color)
    ) {
      setHexDraft(color.toUpperCase());
    }
  }, [color, hexDraft]);

  function changeHexDraft(value: string): void {
    setHexDraft(value);

    const normalized = normalizeHexColorCode(value.trim());

    if (normalized) {
      onChange(normalized);
    }
  }

  return {
    changeHexDraft,
    hexDraft,
    isHexValid: normalizeHexColorCode(hexDraft.trim()) !== null,
  };
}

function SaturationPad({
  color,
  hsv,
  onChange,
}: SaturationPadProps): React.ReactElement {
  const { t } = useTranslation();

  function updateFromPointer(event: React.PointerEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const saturation = clampRatio((event.clientX - rect.left) / rect.width);
    const value = 1 - clampRatio((event.clientY - rect.top) / rect.height);

    onChange(hsvToHex({ hue: hsv.hue, saturation, value }));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.buttons > 0) {
      updateFromPointer(event);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 0.1 : 0.02;
    let saturation = hsv.saturation;
    let value = hsv.value;

    if (event.key === "ArrowLeft") {
      saturation -= step;
    } else if (event.key === "ArrowRight") {
      saturation += step;
    } else if (event.key === "ArrowUp") {
      value += step;
    } else if (event.key === "ArrowDown") {
      value -= step;
    } else {
      return;
    }

    event.preventDefault();
    onChange(
      hsvToHex({
        hue: hsv.hue,
        saturation: clampRatio(saturation),
        value: clampRatio(value),
      }),
    );
  }

  return (
    <div
      aria-label={t("tasks.labels.customColor")}
      aria-valuetext={color.toUpperCase()}
      className="relative aspect-[7/6] w-full cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsv.saturation * 100)}
      style={{
        backgroundColor: `hsl(${hsv.hue} 100% 50%)`,
        backgroundImage:
          "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
        clipPath: "polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0% 50%)",
      }}
      tabIndex={0}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
        style={{
          backgroundColor: color,
          left: `${hsv.saturation * 100}%`,
          top: `${(1 - hsv.value) * 100}%`,
        }}
      />
    </div>
  );
}

function HueSlider({ hsv, onChange }: HueSliderProps): React.ReactElement {
  const { t } = useTranslation();

  function updateFromPointer(event: React.PointerEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const hue = clampRatio((event.clientX - rect.left) / rect.width) * 360;

    onChange(hsvToHex({ hue, saturation: hsv.saturation, value: hsv.value }));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.buttons > 0) {
      updateFromPointer(event);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 30 : 3;
    let hue = hsv.hue;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      hue -= step;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      hue += step;
    } else {
      return;
    }

    event.preventDefault();
    onChange(
      hsvToHex({
        hue: (hue + 360) % 360,
        saturation: hsv.saturation,
        value: hsv.value,
      }),
    );
  }

  return (
    <div
      aria-label={t("tasks.labels.hue")}
      aria-valuetext={`${Math.round(hsv.hue)}°`}
      className="relative h-3 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hsv.hue)}
      style={{
        backgroundImage:
          "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
      }}
      tabIndex={0}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
        style={{
          backgroundColor: `hsl(${hsv.hue} 100% 50%)`,
          left: `${(hsv.hue / 360) * 100}%`,
        }}
      />
    </div>
  );
}

function HexColorField({
  color,
  onChange,
}: HexColorFieldProps): React.ReactElement {
  const { t } = useTranslation();
  const { changeHexDraft, hexDraft, isHexValid } = useHexDraft(color, onChange);

  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="size-6 shrink-0 rounded-full border border-black/10 shadow-xs"
        style={{ backgroundColor: color }}
      />
      <label
        className="shrink-0 text-xs font-medium text-muted-foreground"
        htmlFor="label-hex-input"
      >
        {t("tasks.labels.hex")}
      </label>
      <input
        id="label-hex-input"
        autoComplete="off"
        className={cn(
          "h-9 min-w-0 flex-1 rounded-lg bg-muted/60 px-2.5 font-mono text-xs tracking-wide text-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-primary",
          !isHexValid && "ring-2 ring-destructive/60",
        )}
        maxLength={7}
        onChange={(event) => changeHexDraft(event.target.value)}
        spellCheck={false}
        value={hexDraft}
      />
    </div>
  );
}

/**
 * Renders a free color picker with a hexagon saturation pad.
 * @remarks
 * Visually follows the hexagon-picker idea without pulling in its
 * unmaintained React 16 dependency: the saturation pad is clipped to a
 * hexagon, the hue runs on a slider below, and the exact value stays editable
 * as HEX. Colors leave the picker already normalized to `#rrggbb`, matching
 * the preset representation one to one.
 */
export function HexagonColorPicker({
  color,
  onChange,
}: HexagonColorPickerProps): React.ReactElement {
  const hsv = hexToHsv(color);

  return (
    <div className="flex flex-col gap-3">
      <SaturationPad color={color} hsv={hsv} onChange={onChange} />
      <HueSlider hsv={hsv} onChange={onChange} />
      <HexColorField color={color} onChange={onChange} />
    </div>
  );
}
