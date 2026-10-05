import { useTranslation } from "react-i18next";

import { clampRatio } from "@/app/components/tasks/hexagon-color-picker/clamp-ratio";
import { hsvToHex } from "@/app/components/tasks/label-color";

import type { HsvColor } from "@/app/components/tasks/label-color";

interface HueSliderProps {
  readonly hsv: HsvColor;
  readonly onChange: (color: string) => void;
}

/** Renders the rainbow slider that picks the hue. */
export function HueSlider({
  hsv,
  onChange,
}: HueSliderProps): React.ReactElement {
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
