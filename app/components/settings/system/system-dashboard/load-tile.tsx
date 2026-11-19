import { cn } from "@/app/lib/cn";

import { LOAD_STROKES, loadLevel } from "./load-level";
import { LoadSparkline } from "./load-sparkline";

import type { LoadSample } from "./load-history";

const DONUT_SIZE = 72;
const DONUT_STROKE_WIDTH = 7;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE_WIDTH) / 2;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

interface LoadTileProps {
  readonly name: string;
  /** The value in the ring, such as `46 %`. */
  readonly value: string;
  /** The share the ring and its color show; `null` leaves the ring empty. */
  readonly ratio: number | null;
  /** The first line of details; `null` leaves it out. */
  readonly detail: string | null;
  /** The second line of details; `null` leaves it out. */
  readonly secondDetail: string | null;
  readonly samples: readonly LoadSample[];
  /** The time of the newest reading, where the curve ends. */
  readonly end: number | null;
}

interface LoadDonutProps {
  readonly ratio: number | null;
  readonly label: string;
}

function LoadDonut({ ratio, label }: LoadDonutProps): React.ReactElement {
  const center = DONUT_SIZE / 2;
  const level = ratio === null ? null : loadLevel(ratio);

  return (
    <div
      className="relative size-18 shrink-0"
      data-load-level={level ?? "none"}
    >
      <svg
        viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
        className="size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={center}
          cy={center}
          r={DONUT_RADIUS}
          fill="none"
          strokeWidth={DONUT_STROKE_WIDTH}
          className="stroke-muted"
        />
        {ratio !== null && level !== null && ratio > 0 ? (
          <circle
            cx={center}
            cy={center}
            r={DONUT_RADIUS}
            fill="none"
            strokeWidth={DONUT_STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={`${ratio * DONUT_CIRCUMFERENCE} ${DONUT_CIRCUMFERENCE}`}
            className={cn(LOAD_STROKES[level], "transition-[stroke-dasharray]")}
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold whitespace-nowrap text-foreground tabular-nums">
        {label}
      </span>
    </div>
  );
}

function DetailLine({
  text,
}: {
  readonly text: string | null;
}): React.ReactElement | null {
  if (text === null) return null;
  return (
    <p className="mt-1 text-[13px] leading-snug break-words text-muted-foreground tabular-nums">
      {text}
    </p>
  );
}

/** One tile of the load section: ring, name, details and the curve of ten minutes. */
export function LoadTile({
  name,
  value,
  ratio,
  detail,
  secondDetail,
  samples,
  end,
}: LoadTileProps): React.ReactElement {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <LoadDonut ratio={ratio} label={value} />
        <div className="min-w-0">
          <h4 className="truncate text-base font-semibold text-foreground">
            {name}
          </h4>
          <DetailLine text={detail} />
          <DetailLine text={secondDetail} />
        </div>
      </div>
      <LoadSparkline samples={samples} end={end} />
    </article>
  );
}
