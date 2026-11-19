import { Ban, Check, Clock, Minus, TrendingDown } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { claudeQuotaTone } from "@/definition/ClaudeQuota";

import { QUOTA_BAR_CLASSES } from "./quota-card-layout";
import { formatQuotaDuration } from "./quota-time";

import type { TFunction } from "i18next";
import type { QuotaForecast } from "@/definition/QuotaForecast";

const FORECAST_ICONS = {
  enough: Check,
  collecting: Clock,
  steady: Minus,
  newWindow: Clock,
  unavailable: Ban,
  depleting: TrendingDown,
};

type Forecast = QuotaForecast["forecast"];

interface ForecastText {
  readonly full: string;
  readonly short: string;
  readonly narrow: string;
  readonly accessible: string;
}

function forecastText(forecast: Forecast, t: TFunction): ForecastText {
  if (forecast.kind === "depleting") {
    const isBelowMinute = forecast.timeToEmpty < 60_000;
    const duration = isBelowMinute
      ? t("agentsPage.forecasts.underMinute")
      : formatQuotaDuration(forecast.timeToEmpty, t);
    const accessibleDuration = isBelowMinute
      ? t("agentsPage.forecasts.underMinuteFull")
      : formatQuotaDuration(forecast.timeToEmpty, t, true);
    return {
      full: t("agentsPage.forecasts.depleting", { duration }),
      short: t("agentsPage.forecasts.depletingShort", { duration }),
      narrow: duration,
      accessible: t("agentsPage.forecasts.depleting", {
        duration: accessibleDuration,
      }),
    };
  }
  const full = t(`agentsPage.forecasts.${forecast.kind}`);
  const short = t(`agentsPage.forecasts.${forecast.kind}Short`, {
    defaultValue: full,
  });
  return {
    full,
    short,
    narrow: forecast.kind === "enough" ? "" : short,
    accessible: full,
  };
}

/** Renders the forecast with a shorter label when space is limited. */
export function QuotaForecastLabel({
  forecast,
  variant,
  isCompact = false,
}: {
  readonly forecast: Forecast;
  readonly variant: "window" | "group";
  readonly isCompact?: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (forecast.kind === "hidden") return null;
  const Icon = FORECAST_ICONS[forecast.kind];
  const words = forecastText(forecast, t);
  const isWarning = forecast.kind === "depleting";
  return (
    <span
      title={words.full}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 whitespace-nowrap font-semibold",
        variant === "window" ? "text-[11.5px]" : "text-[11px]",
        isWarning ? "text-destructive" : "text-muted-foreground",
        isWarning &&
          variant === "window" &&
          "rounded-md bg-destructive-subtle px-[7px] ring-1 ring-destructive/45 ring-inset",
        isWarning && variant === "window" && (isCompact ? "h-4" : "h-5"),
      )}
    >
      <Icon aria-hidden="true" className="size-[13px] shrink-0" />
      <span className="sr-only">{words.accessible}</span>
      {variant === "window" ? (
        <>
          <span aria-hidden="true" className="truncate @min-[440px]:hidden">
            {words.short}
          </span>
          <span
            aria-hidden="true"
            className="hidden truncate @min-[440px]:inline"
          >
            {words.full}
          </span>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="truncate @min-[210px]:hidden">
            {words.narrow}
          </span>
          <span
            aria-hidden="true"
            className="hidden truncate @min-[210px]:inline"
          >
            {words.short}
          </span>
        </>
      )}
    </span>
  );
}

/** Identifies the target marker using both its shape and its percentage. */
export function QuotaTargetLegend({
  target,
  className,
  isNarrow = false,
  hasSeparator,
}: {
  readonly target: number;
  readonly className?: string;
  readonly isNarrow?: boolean;
  readonly hasSeparator?: "always" | "desktop";
}): React.ReactElement {
  const { t } = useTranslation();
  const full = t("agentsPage.forecasts.target", { percent: target });
  const short = t("agentsPage.forecasts.targetShort", { percent: target });
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-[11px] w-[3px] rounded-sm bg-quota-pace"
      />
      <span className="sr-only">{full}</span>
      <span
        aria-hidden="true"
        className={isNarrow ? "@min-[210px]:hidden" : "@min-[440px]:hidden"}
      >
        {short}
      </span>
      <span
        aria-hidden="true"
        className={
          isNarrow ? "hidden @min-[210px]:inline" : "hidden @min-[440px]:inline"
        }
      >
        {full}
      </span>
      {hasSeparator ? (
        <span
          aria-hidden="true"
          className={cn(
            "text-muted-foreground",
            hasSeparator === "desktop" && "hidden md:inline",
          )}
        >
          ·
        </span>
      ) : null}
    </span>
  );
}

interface QuotaProgressProps {
  readonly label: string;
  readonly remaining: number;
  readonly measuredRemaining: number;
  readonly projection: QuotaForecast;
  readonly isNarrow?: boolean;
}

function fillClass(remaining: number, projection: QuotaForecast): string {
  if (projection.forecast.kind === "depleting")
    return "bg-[color-mix(in_srgb,var(--color-destructive)_30%,var(--color-muted))]";
  return QUOTA_BAR_CLASSES[claudeQuotaTone(remaining)];
}

function QuotaForecastStripes({
  forecast,
  measuredRemaining,
}: {
  readonly forecast: Forecast;
  readonly measuredRemaining: number;
}): React.ReactElement | null {
  const isWarning = forecast.kind === "depleting";
  if (!isWarning && forecast.kind !== "enough") return null;
  if (measuredRemaining <= 0) return null;
  const left =
    forecast.kind === "enough"
      ? (100 * forecast.restAtReset) / measuredRemaining
      : 0;
  if (left >= 100) return null;
  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-[repeating-linear-gradient(135deg,var(--quota-stripe)_0_2px,transparent_2px_5px)] transition-[clip-path] duration-300 ease-out motion-reduce:transition-none",
          isWarning
            ? "[--quota-stripe:var(--color-destructive)]"
            : "[--quota-stripe:color-mix(in_srgb,var(--color-surface)_78%,transparent)]",
        )}
        style={{ clipPath: `inset(0 0 0 ${left}%)` }}
      />
      {isWarning ? null : (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 bg-foreground/75 transition-[left] duration-300 ease-out motion-reduce:transition-none"
          style={{ left: `${left}%` }}
        />
      )}
    </>
  );
}

/** Shows measured rest, target marker and projected usage on the same scale. */
export function QuotaProgress({
  label,
  remaining,
  measuredRemaining,
  projection,
  isNarrow = false,
}: QuotaProgressProps): React.ReactElement {
  const { t } = useTranslation();
  const descriptionId = useId();
  const { target, forecast } = projection;
  const tone = claudeQuotaTone(remaining);
  const description = [
    target === null
      ? null
      : t("agentsPage.forecasts.target", { percent: target }),
    forecast.kind === "hidden" ? null : forecastText(forecast, t).accessible,
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <>
      <div
        role="progressbar"
        aria-label={label}
        aria-describedby={description ? descriptionId : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remaining}
        className={cn(
          "relative shrink-0",
          isNarrow ? "h-2 rounded-[4px]" : "h-2.5 rounded-[5px]",
        )}
      >
        <div className="h-full overflow-hidden rounded-[inherit] bg-muted">
          <div
            data-quota-bar={tone}
            className={cn(
              "relative h-full overflow-hidden rounded-[inherit] transition-[width,background-color,opacity] duration-300 ease-out motion-reduce:transition-none",
              fillClass(remaining, projection),
            )}
            style={{ width: `${remaining}%` }}
          >
            <QuotaForecastStripes
              forecast={forecast}
              measuredRemaining={measuredRemaining}
            />
          </div>
        </div>
        {target === null ? null : (
          <span
            aria-hidden="true"
            data-quota-target={target}
            className={cn(
              "absolute top-1/2 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-quota-pace ring-[1.5px] ring-surface transition-[left] duration-300 ease-out motion-reduce:transition-none",
              isNarrow ? "h-3.5" : "h-4",
            )}
            style={{ left: `clamp(3.5px, ${target}%, calc(100% - 3.5px))` }}
          />
        )}
      </div>
      {description ? (
        <span id={descriptionId} className="sr-only">
          {description}.
        </span>
      ) : null}
    </>
  );
}
