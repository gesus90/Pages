import { useTranslation } from "react-i18next";

import { clampRatio } from "@/app/components/tasks/hexagon-color-picker/clamp-ratio";
import { hsvToHex } from "@/app/components/tasks/label-color";

import type { HsvColor } from "@/app/components/tasks/label-color";

interface SaturationPadProps {
  readonly color: string;
  readonly hsv: HsvColor;
  readonly onChange: (color: string) => void;
}

/** Renders the hexagon-clipped pad that picks saturation and brightness. */
export function SaturationPad({
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
