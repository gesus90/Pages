import { cn } from "@/app/lib/cn";

import { LOAD_FILLS, loadLevel } from "./load-level";

import type { ReactNode } from "react";

interface DashboardPanelProps {
  readonly title: string;
  /** A short figure at the right of the heading, such as `4 eingehängt`. */
  readonly meta: string;
  readonly children: ReactNode;
}

/** A framed section of the dashboard with its heading and a figure. */
export function DashboardPanel({
  title,
  meta,
  children,
}: DashboardPanelProps): React.ReactElement {
  return (
    <section className="min-w-0 rounded-xl border border-border p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {meta}
        </span>
      </header>
      {children}
    </section>
  );
}

interface UsageBarProps {
  /** Share from 0 to 1; `null` leaves the bar empty and grey. */
  readonly ratio: number | null;
  /** Height and width of the bar. */
  readonly className: string;
}

/** A bar filled by a share in the color of its load level. */
export function UsageBar({
  ratio,
  className,
}: UsageBarProps): React.ReactElement {
  const level = ratio === null ? null : loadLevel(ratio);

  return (
    <div
      className={cn("overflow-hidden rounded-full bg-muted", className)}
      data-load-level={level ?? "none"}
      aria-hidden="true"
    >
      {ratio === null || level === null ? null : (
        <div
          className={cn("h-full rounded-full", LOAD_FILLS[level])}
          // A sliver stays visible for a share that rounds to nothing.
          style={{ width: `${Math.max(ratio * 100, 1)}%` }}
        />
      )}
    </div>
  );
}
