import { cn } from "@/app/lib/cn";
import {
  DashboardTrendFlatIcon,
  DashboardTrendUpIcon,
} from "@/app/components/dashboard/dashboard-icons";

/** Visual tone of a KPI delta line. */
type DashboardKpiTone = "accent" | "muted" | "positive";

const DECORATION_CLASSES = {
  primary: {
    card: "[--metric-accent:var(--color-metric-primary)]",
    icon: "bg-metric-primary-subtle text-metric-primary",
  },
  secondary: {
    card: "[--metric-accent:var(--color-metric-secondary)]",
    icon: "bg-metric-secondary-subtle text-metric-secondary",
  },
  tertiary: {
    card: "[--metric-accent:var(--color-metric-tertiary)]",
    icon: "bg-metric-tertiary-subtle text-metric-tertiary",
  },
  quaternary: {
    card: "[--metric-accent:var(--color-metric-quaternary)]",
    icon: "bg-metric-quaternary-subtle text-metric-quaternary",
  },
} as const;

interface DashboardKpiCardProps {
  readonly decoration?: keyof typeof DECORATION_CLASSES;
  readonly label: string;
  readonly value: number;
  readonly deltaValue: string;
  readonly deltaSuffix: string;
  readonly tone?: DashboardKpiTone;
  readonly icon: React.ReactNode;
}

/**
 * Renders one equally sized KPI card of the dashboard top row.
 *
 * @param props - Label, value, delta line, tone, and leading icon.
 * @returns The KPI card element.
 */
export function DashboardKpiCard({
  label,
  value,
  deltaValue,
  deltaSuffix,
  tone = "accent",
  icon,
  decoration = "primary",
}: DashboardKpiCardProps): React.ReactElement {
  const isFlat = tone === "muted";
  const TrendIcon = isFlat ? DashboardTrendFlatIcon : DashboardTrendUpIcon;

  return (
    <article
      className={cn(
        "pages-metric-card min-w-0 rounded-2xl bg-surface p-5 shadow-card",
        DECORATION_CLASSES[decoration].card,
      )}
    >
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "inline-flex size-12 shrink-0 select-none items-center justify-center rounded-xl shadow-metric",
            DECORATION_CLASSES[decoration].icon,
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted-foreground">
            {label}
          </p>
          <p className="mt-0.5 text-3xl font-bold tracking-tight text-foreground tabular-nums">
            {value}
          </p>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 pl-16 text-xs">
        <TrendIcon
          className={cn(
            "size-4",
            tone === "positive" && "text-trend-positive",
            tone === "accent" && "text-primary",
            tone === "muted" && "text-muted-foreground",
          )}
        />
        <span
          className={cn(
            "font-semibold tabular-nums",
            tone === "positive" && "text-trend-positive",
            tone === "accent" && "text-primary",
            tone === "muted" && "text-muted-foreground",
          )}
        >
          {deltaValue}
        </span>
        <span className="truncate text-muted-foreground">{deltaSuffix}</span>
      </p>
    </article>
  );
}
