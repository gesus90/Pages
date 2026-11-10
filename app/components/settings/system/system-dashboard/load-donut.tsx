import { cn } from "@/app/lib/cn";

import { LOAD_STROKES, loadLevel } from "./load-level";

const SIZE = 72;
const STROKE_WIDTH = 7;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface LoadDonutProps {
  /** Share from 0 to 1; `null` leaves the ring empty. */
  readonly ratio: number | null;
  /** The value in the middle, such as `46 %` or `4`. */
  readonly label: string;
}

/** A ring filled by a share in the color of its load level, with the value in the middle. */
export function LoadDonut({
  ratio,
  label,
}: LoadDonutProps): React.ReactElement {
  const center = SIZE / 2;
  const level = ratio === null ? null : loadLevel(ratio);

  return (
    <div
      className="relative size-18 shrink-0"
      data-load-level={level ?? "none"}
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={center}
          cy={center}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="stroke-muted"
        />
        {ratio !== null && level !== null && ratio > 0 ? (
          <circle
            cx={center}
            cy={center}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={`${ratio * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
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
