import {
  DEFAULT_USER_SETTINGS,
  USER_NOTIFICATION_KEYS,
  isUserDateFormat,
  isUserTimezone,
  isUserWeekStart,
} from "@/definition/Settings";
import { isLanguage } from "@/language/Language";

import type { UserNotificationKey, UserSettings } from "@/definition/Settings";

/**
 * Reads the notification switches of the settings form.
 *
 * @returns Every switch as a boolean, or `null` when one is missing or no
 * `on`/`off` value.
 */
function parseNotifications(
  formData: FormData,
): Record<UserNotificationKey, boolean> | null {
  // Every key is overwritten below; the defaults only give the record its shape.
  const notifications: Record<UserNotificationKey, boolean> = {
    ...DEFAULT_USER_SETTINGS.notifications,
  };

  for (const key of USER_NOTIFICATION_KEYS) {
    const raw = formData.get(`notification.${key}`);

    if (raw !== "on" && raw !== "off") {
      return null;
    }

    notifications[key] = raw === "on";
  }

  return notifications;
}

/** Parses a complete user settings payload sent by the settings form. */
export function parseSettingsForm(formData: FormData): UserSettings | null {
  const language = formData.get("language");
  const timezone = formData.get("timezone");
  const dateFormat = formData.get("dateFormat");
  const weekStart = formData.get("weekStart");

  if (
    !isLanguage(language) ||
    typeof timezone !== "string" ||
    (timezone !== "" && !isUserTimezone(timezone)) ||
    !isUserDateFormat(dateFormat) ||
    !isUserWeekStart(weekStart)
  ) {
    return null;
  }

  const notifications = parseNotifications(formData);

  if (!notifications) {
    return null;
  }

  return {
    language,
    timezone: timezone === "" ? null : timezone,
    dateFormat,
    weekStart,
    notifications,
  };
}
