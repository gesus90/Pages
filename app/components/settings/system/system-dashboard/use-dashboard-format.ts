import { useTranslation } from "react-i18next";

import { useRegionFormat } from "@/app/components/common/region-provider";
import {
  calendarDaysBefore,
  formatDate,
  formatTimeOfDay,
} from "@/app/lib/region-format";

/** What the dashboard shows for a value it does not have. */
export const MISSING_VALUE = "—";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const BYTES_PER_UNIT = 1024;
const GIBIBYTE = BYTES_PER_UNIT ** 3;
const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_HOURS = 24;

interface ByteAmount {
  readonly value: number;
  readonly unit: (typeof BYTE_UNITS)[number];
}

/** Formats numbers, sizes and times of the dashboard in the format of the language. */
export interface DashboardFormat {
  /** Such as `46 %`; {@link MISSING_VALUE} without a value. */
  readonly percent: (ratio: number | null) => string;
  /** A number with a fixed count of decimals, such as `3,91`. */
  readonly decimal: (value: number, fractionDigits: number) => string;
  /** Such as `415 MB` or `1,5 GB`; one decimal below ten. */
  readonly bytes: (bytes: number | null) => string;
  /** The number of gibibytes with one decimal, such as `15,2`. */
  readonly gigabytes: (bytes: number) => string;
  /** Such as `206 von 457 GB`, or `6 MB von 1,1 GB` for different units. */
  readonly usage: (used: number, total: number) => string;
  /** Time since an instant, such as `2 Std. 25 Min.`. */
  readonly duration: (since: number | null, now: number) => string;
  /** Such as `71 °C`. */
  readonly celsius: (degrees: number) => string;
  /** Such as `heute 09:30`, `gestern 03:30` or a date. */
  readonly day: (instant: number | null, now: number) => string;
}

function splitBytes(bytes: number): ByteAmount {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit += 1;
  }
  return { value, unit: BYTE_UNITS[unit] ?? "TB" };
}

function amountDigits(amount: ByteAmount): number {
  return amount.value < 10 && amount.unit !== "B" ? 1 : 0;
}

/**
 * Returns the formatters of the dashboard for the current language and region.
 *
 * @remarks
 * Sizes count in steps of 1024, as the other sizes of Pages do.
 */
export function useDashboardFormat(): DashboardFormat {
  const { t, i18n } = useTranslation();
  const region = useRegionFormat();
  const language = i18n.language;

  function decimal(value: number, fractionDigits: number): string {
    return new Intl.NumberFormat(language, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  }

  function amount(byteAmount: ByteAmount): string {
    return decimal(byteAmount.value, amountDigits(byteAmount));
  }

  function bytes(value: number | null): string {
    if (value === null) return MISSING_VALUE;
    const byteAmount = splitBytes(value);
    return `${amount(byteAmount)} ${byteAmount.unit}`;
  }

  function usage(used: number, total: number): string {
    const usedAmount = splitBytes(used);
    const totalAmount = splitBytes(total);
    const isSameUnit = usedAmount.unit === totalAmount.unit;
    return t("settings.system.dashboard.usage", {
      used: isSameUnit ? amount(usedAmount) : bytes(used),
      total: bytes(total),
    });
  }

  function duration(since: number | null, now: number): string {
    if (since === null) return MISSING_VALUE;
    const minutes = Math.floor(Math.max(0, now - since) / MINUTE_MS);
    const hours = Math.floor(minutes / HOUR_MINUTES);
    const days = Math.floor(hours / DAY_HOURS);
    if (days > 0)
      return t("settings.system.dashboard.duration.days", {
        days,
        hours: hours % DAY_HOURS,
      });
    if (hours > 0)
      return t("settings.system.dashboard.duration.hours", {
        hours,
        minutes: minutes % HOUR_MINUTES,
      });
    if (minutes > 0)
      return t("settings.system.dashboard.duration.minutes", { minutes });
    return t("settings.system.dashboard.duration.underMinute");
  }

  function day(instant: number | null, now: number): string {
    if (instant === null) return MISSING_VALUE;
    const value = new Date(instant).toISOString();
    const days = calendarDaysBefore(value, new Date(now), region);
    const time = formatTimeOfDay(value, region);
    if (days === 0) return t("settings.system.dashboard.day.today", { time });
    if (days === 1)
      return t("settings.system.dashboard.day.yesterday", { time });
    return formatDate(value, region);
  }

  return {
    percent: (ratio) =>
      ratio === null
        ? MISSING_VALUE
        : new Intl.NumberFormat(language, {
            style: "percent",
            maximumFractionDigits: 0,
          }).format(ratio),
    decimal,
    bytes,
    gigabytes: (value) => decimal(value / GIBIBYTE, 1),
    usage,
    duration,
    celsius: (degrees) =>
      new Intl.NumberFormat(language, {
        style: "unit",
        unit: "celsius",
        maximumFractionDigits: 0,
      }).format(degrees),
    day,
  };
}
