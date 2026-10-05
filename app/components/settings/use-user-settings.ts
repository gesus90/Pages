import { useEffect, useState } from "react";
import { useNavigation, useSubmit } from "react-router";

import { USER_NOTIFICATION_KEYS } from "@/definition/Settings";

import type { UserNotificationKey, UserSettings } from "@/definition/Settings";

/** The settings shown on the screen and the ways to change them. */
export interface UserSettingsState {
  readonly settings: UserSettings;
  /** Applies the patch to the screen at once and submits all settings. */
  readonly persistSettings: (patch: Partial<UserSettings>) => void;
  readonly toggleNotification: (key: UserNotificationKey) => void;
}

function createSettingsFormData(settings: UserSettings): FormData {
  const formData = new FormData();

  formData.set("intent", "update-settings");
  formData.set("language", settings.language);
  formData.set("timezone", settings.timezone ?? "");
  formData.set("dateFormat", settings.dateFormat);
  formData.set("weekStart", settings.weekStart);

  for (const key of USER_NOTIFICATION_KEYS) {
    formData.set(
      `notification.${key}`,
      settings.notifications[key] ? "on" : "off",
    );
  }

  return formData;
}

/**
 * Keeps the settings of the screen in step with the stored ones.
 *
 * @param loadedSettings - The settings the loader returned.
 *
 * @remarks
 * Changes show immediately; the stored settings replace them as soon as the
 * navigation is idle again, which also reverts a rejected change.
 */
export function useUserSettings(
  loadedSettings: UserSettings,
): UserSettingsState {
  const submit = useSubmit();
  const navigation = useNavigation();
  const [settings, setSettings] = useState<UserSettings>(loadedSettings);

  useEffect(() => {
    if (navigation.state === "idle") {
      setSettings(loadedSettings);
    }
  }, [navigation.state, loadedSettings]);

  function persistSettings(patch: Partial<UserSettings>): void {
    const updated = { ...settings, ...patch };

    setSettings(updated);
    void submit(createSettingsFormData(updated), { method: "post" });
  }

  function toggleNotification(key: UserNotificationKey): void {
    persistSettings({
      notifications: {
        ...settings.notifications,
        [key]: !settings.notifications[key],
      },
    });
  }

  return { persistSettings, settings, toggleNotification };
}
