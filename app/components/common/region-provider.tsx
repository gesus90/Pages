import { createContext, useContext, useSyncExternalStore } from "react";

import { formatDate, formatDateTime } from "@/app/lib/region-format";
import { DEFAULT_USER_SETTINGS, isUserCurrency } from "@/definition/Settings";

import type { RegionFormat } from "@/app/lib/region-format";
import type {
  UserCurrency,
  UserDateFormat,
  UserTimezone,
} from "@/definition/Settings";
import type { ReactNode } from "react";

/** The region choices of the signed-in user. */
export interface RegionPreferences {
  /** Chosen time zone, or `null` for the one of the browser. */
  readonly timezone: UserTimezone | null;
  readonly dateFormat: UserDateFormat;
  /**
   * The currency costs are shown in; missing in answers kept from before the
   * currency choice, which show US dollars.
   */
  readonly currency?: UserCurrency;
}

/** Formats dates and times the way the signed-in user chose. */
export interface RegionFormatter {
  /** Formats a calendar date or timestamp as a date; `---` without a value. */
  readonly formatDate: (value: string | null) => string;
  /** Formats a timestamp with the time of day; `---` without a value. */
  readonly formatDateTime: (value: string | null) => string;
}

const SERVER_TIME_ZONE = "UTC";

const RegionContext = createContext<RegionPreferences>({
  dateFormat: "DD.MM.YYYY",
  timezone: null,
});

function subscribeToNothing(): () => void {
  return () => {};
}

function readBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function readServerTimeZone(): string {
  return SERVER_TIME_ZONE;
}

/** Makes the region choices of the signed-in user available to the screens below. */
export function RegionProvider({
  region,
  children,
}: {
  readonly region: RegionPreferences;
  readonly children: ReactNode;
}): React.ReactElement {
  return <RegionContext value={region}>{children}</RegionContext>;
}

/**
 * Returns the date format and the time zone dates are shown in.
 * @remarks
 * Without a chosen time zone, the zone of the browser applies. The server
 * does not know it, so it renders UTC and the browser takes over right after
 * hydration, which keeps both renderings identical while hydrating.
 */
export function useRegionFormat(): RegionFormat {
  const { dateFormat, timezone } = useContext(RegionContext);
  const browserTimeZone = useSyncExternalStore(
    subscribeToNothing,
    readBrowserTimeZone,
    readServerTimeZone,
  );

  return { dateFormat, timeZone: timezone ?? browserTimeZone };
}

/**
 * Returns the currency the signed-in user wants costs shown in.
 * @remarks
 * Accounts without a choice, and answers kept from before the choice
 * existed, keep the US dollar display.
 */
export function useDisplayCurrency(): UserCurrency {
  const { currency } = useContext(RegionContext);

  return isUserCurrency(currency) ? currency : DEFAULT_USER_SETTINGS.currency;
}

/**
 * Returns formatters for the date format and time zone of the user.
 * @remarks
 * The time zone follows {@link useRegionFormat}.
 */
export function useRegionFormatter(): RegionFormatter {
  const region = useRegionFormat();

  return {
    formatDate: (value) => formatDate(value, region),
    formatDateTime: (value) => formatDateTime(value, region),
  };
}
