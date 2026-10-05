import { linkMidColor } from "@/app/lib/phase-plan/plan-colors";
import { dependencyPath } from "@/app/lib/phase-plan/plan-layout";

import type { DependencyLink } from "@/app/lib/phase-plan/plan-types";

interface PlanLinksOverlayProps {
  readonly links: readonly DependencyLink[];
  readonly trackWidth: number;
  readonly bodyHeight: number;
}

const DOT_CLASS =
  "pointer-events-none absolute z-[7] size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full";

/** Renders the dashed dependency curves with a dot at both ends. */
export function PlanLinksOverlay({
  links,
  trackWidth,
  bodyHeight,
}: PlanLinksOverlayProps): React.ReactElement {
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 z-[5]"
        width={trackWidth}
        height={bodyHeight}
        aria-hidden="true"
      >
        <defs>
          {links.map((link) => (
            <linearGradient
              key={`plan-grad-${link.key}`}
              id={`plan-grad-${link.key}`}
              gradientUnits="userSpaceOnUse"
              x1={link.fromX}
              y1={link.fromY}
              x2={link.toX}
              y2={link.toY}
            >
              <stop offset="0%" stopColor={link.fromColor} />
              <stop
                offset="50%"
                stopColor={linkMidColor(link.fromColor, link.toColor)}
              />
              <stop offset="100%" stopColor={link.toColor} />
            </linearGradient>
          ))}
        </defs>
        {links.map((link) => (
          <path
            key={link.key}
            d={dependencyPath(link)}
            fill="none"
            stroke={`url(#plan-grad-${link.key})`}
            strokeWidth="1.5"
            strokeDasharray="5 4"
            strokeOpacity={link.opacity}
          />
        ))}
      </svg>
      {links.map((link) => (
        <span
          key={`${link.key}-origin`}
          aria-hidden="true"
          className={DOT_CLASS}
          style={{
            backgroundColor: link.fromColor,
            left: `${link.fromX}px`,
            opacity: link.opacity,
            top: `${link.fromY}px`,
          }}
        />
      ))}
      {links.map((link) => (
        <span
          key={`${link.key}-target`}
          aria-hidden="true"
          className={DOT_CLASS}
          style={{
            backgroundColor: link.toColor,
            left: `${link.toX}px`,
            opacity: link.opacity,
            top: `${link.toY}px`,
          }}
        />
      ))}
    </>
  );
}
