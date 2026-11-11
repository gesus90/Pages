import { useId } from "react";
import { useTranslation } from "react-i18next";

import { HISTORY_WINDOW_MS } from "./load-history";
import { LOAD_STOP_COLORS, LOAD_THRESHOLDS } from "./load-level";

import type { LoadSample } from "./load-history";
import type { LoadLevel } from "./load-level";

const WIDTH = 200;
const HEIGHT = 44;
/** Keeps the line of 0 % and 100 % inside the box. */
const PADDING = 3;
/** Readings further apart were not watched in between; the line breaks there. */
const MAXIMUM_CONNECTED_GAP_MS = 6000;

/** The color bands of the curve from the bottom up: each level from its threshold. */
const BANDS: readonly { readonly level: LoadLevel; readonly from: number }[] = [
  { level: "normal", from: 0 },
  { level: "elevated", from: LOAD_THRESHOLDS.elevated },
  { level: "high", from: LOAD_THRESHOLDS.high },
  { level: "critical", from: LOAD_THRESHOLDS.critical },
];

function heightOf(ratio: number): number {
  return HEIGHT - PADDING - ratio * (HEIGHT - 2 * PADDING);
}

/** The path of the readings in the window that ends with the newest reading. */
function curvePath(samples: readonly LoadSample[], end: number): string {
  const start = end - HISTORY_WINDOW_MS;
  const steps: string[] = [];
  let previous: LoadSample | null = null;
  for (const sample of samples) {
    if (sample.ratio === null) {
      previous = null;
      continue;
    }
    const x = (((sample.at - start) / HISTORY_WINDOW_MS) * WIDTH).toFixed(2);
    const y = heightOf(sample.ratio).toFixed(2);
    const isConnected =
      previous !== null && sample.at - previous.at <= MAXIMUM_CONNECTED_GAP_MS;
    // A lone reading starts with a line of no length, which draws a dot.
    steps.push(isConnected ? `L${x} ${y}` : `M${x} ${y} L${x} ${y}`);
    previous = sample;
  }
  return steps.join(" ");
}

/** The stops of the vertical gradient: a hard change of color at every threshold. */
function GradientStops(): React.ReactElement {
  return (
    <>
      {BANDS.map((band, index) => (
        <BandStops
          key={band.level}
          level={band.level}
          from={band.from}
          to={BANDS[index + 1]?.from ?? 1}
        />
      ))}
    </>
  );
}

function BandStops({
  level,
  from,
  to,
}: {
  readonly level: LoadLevel;
  readonly from: number;
  readonly to: number;
}): React.ReactElement {
  return (
    <>
      <stop offset={from} className={LOAD_STOP_COLORS[level]} />
      <stop offset={to} className={LOAD_STOP_COLORS[level]} />
    </>
  );
}

interface LoadSparklineProps {
  readonly samples: readonly LoadSample[];
  /** The time of the newest reading; the window of ten minutes ends there. */
  readonly end: number | null;
}

/**
 * Draws the readings of the last ten minutes as a line, colored at every point by its value.
 *
 * @remarks
 * The stroke is a gradient over the height of the box, so each part of the
 * line takes the color of the load level at its height: a peak above 80 %
 * is orange even while the current value is green. The line breaks where
 * the page was not watched.
 */
export function LoadSparkline({
  samples,
  end,
}: LoadSparklineProps): React.ReactElement {
  const { t } = useTranslation();
  const gradientId = `load-curve-${useId().replace(/[^\w-]/gu, "")}`;
  const path = end === null ? "" : curvePath(samples, end);

  return (
    <div className="flex items-end gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-11 min-w-0 flex-1"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1={heightOf(0)}
            x2="0"
            y2={heightOf(1)}
          >
            <GradientStops />
          </linearGradient>
        </defs>
        {path === "" ? null : (
          <path
            d={path}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span className="shrink-0 text-xs text-muted-foreground">
        {t("settings.system.dashboard.window")}
      </span>
    </div>
  );
}
