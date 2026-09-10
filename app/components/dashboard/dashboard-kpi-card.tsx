import { cn } from "@/app/lib/cn";
import {
  DashboardTrendFlatIcon,
  DashboardTrendUpIcon,
} from "@/app/components/dashboard/dashboard-icons";

/** Visual tone of a KPI delta line. */
export type DashboardKpiTone = "accent" | "muted" | "positive";

interface DashboardKpiCardProps {
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
}: DashboardKpiCardProps): React.ReactElement {
  const isFlat = tone === "muted";
  const TrendIcon = isFlat ? DashboardTrendFlatIcon : DashboardTrendUpIcon;

  return (
    <article className="min-w-0 rounded-2xl bg-surface p-5 shadow-card">
      <div className="flex items-start gap-4">
        <span className="inline-flex size-12 shrink-0 select-none items-center justify-center rounded-xl bg-primary-subtle text-primary">
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
            tone === "positive" && "text-green-600",
            tone === "accent" && "text-primary",
            tone === "muted" && "text-muted-foreground",
          )}
        />
        <span
          className={cn(
            "font-semibold tabular-nums",
            tone === "positive" && "text-green-600",
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
