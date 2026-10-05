import { LANGUAGE } from "@/language/Language";

import type { Language } from "@/language/Language";

/** Date formats a user can select for rendering dates. */
export const USER_DATE_FORMATS = [
  "DD.MM.YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
] as const;

/** A date format a user can select for rendering dates. */
export type UserDateFormat = (typeof USER_DATE_FORMATS)[number];

/** Narrows an unknown value to a supported user date format. */
export function isUserDateFormat(value: unknown): value is UserDateFormat {
  return (
    typeof value === "string" &&
    (USER_DATE_FORMATS as readonly string[]).includes(value)
  );
}

/** Week start days a user can select. */
const USER_WEEK_STARTS = ["monday", "sunday"] as const;

/** A week start day a user can select. */
export type UserWeekStart = (typeof USER_WEEK_STARTS)[number];

/** Narrows an unknown value to a supported user week start. */
export function isUserWeekStart(value: unknown): value is UserWeekStart {
  return (
    typeof value === "string" &&
    (USER_WEEK_STARTS as readonly string[]).includes(value)
  );
}

/** Time zones a user can select for rendering dates. */
export const USER_TIMEZONES = [
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Vienna",
  "Europe/Zurich",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
] as const;

/** A time zone a user can select for rendering dates. */
export type UserTimezone = (typeof USER_TIMEZONES)[number];

/** Narrows an unknown value to a supported user time zone. */
export function isUserTimezone(value: unknown): value is UserTimezone {
  return (
    typeof value === "string" &&
    (USER_TIMEZONES as readonly string[]).includes(value)
  );
}

/** Notification channels and events a user can toggle individually. */
interface UserNotifications {
  readonly email: boolean;
  readonly desktop: boolean;
  readonly mentions: boolean;
  readonly assignments: boolean;
  readonly dueDates: boolean;
  readonly weeklySummary: boolean;
}

/**
 * Settings that belong to a single user.
 *
 * @remarks
 * Distinct from future server-wide settings, which apply to every user and
 * are restricted to administrators.
 */
export interface UserSettings {
  readonly language: Language;
  readonly timezone: UserTimezone | null;
  readonly dateFormat: UserDateFormat;
  readonly weekStart: UserWeekStart;
  readonly notifications: UserNotifications;
}

/** Settings applied until a user row stores an explicit value. */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  language: LANGUAGE.GERMAN,
  timezone: null,
  dateFormat: "DD.MM.YYYY",
  weekStart: "monday",
  notifications: {
    assignments: true,
    desktop: true,
    dueDates: true,
    email: true,
    mentions: true,
    weeklySummary: false,
  },
};

/** Notification preference keys a user can toggle in the settings screen. */
export const USER_NOTIFICATION_KEYS = [
  "email",
  "desktop",
  "mentions",
  "assignments",
  "dueDates",
  "weeklySummary",
] as const;

/** A notification preference key a user can toggle. */
export type UserNotificationKey = (typeof USER_NOTIFICATION_KEYS)[number];
