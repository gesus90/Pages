import { Link } from "react-router";

import { cn } from "@/app/lib/cn";
import { DashboardArrowRightIcon } from "@/app/components/dashboard/dashboard-icons";

interface DashboardPanelProps {
  readonly title: string;
  readonly titleId: string;
  readonly linkLabel?: string;
  readonly linkTo?: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}

/**
 * Renders a dashboard panel with consistent rounding, padding, and surface.
 *
 * @remarks
 * Every dashboard panel shares this frame so the middle and bottom rows
 * keep identical visual boundaries, gutters, and inner spacing.
 */
export function DashboardPanel({
  title,
  titleId,
  linkLabel,
  linkTo,
  className,
  children,
}: DashboardPanelProps): React.ReactElement {
  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl bg-surface p-5 shadow-card xl:p-6",
        className,
      )}
      aria-labelledby={titleId}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2
          id={titleId}
          className="truncate text-lg font-bold tracking-tight text-foreground"
        >
          {title}
        </h2>
        {linkLabel && linkTo ? (
          <Link
            className="inline-flex shrink-0 select-none items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary-hover"
            to={linkTo}
            prefetch="intent"
          >
            {linkLabel}
            <DashboardArrowRightIcon className="size-4" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}
