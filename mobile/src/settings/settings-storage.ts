import AsyncStorage from "@react-native-async-storage/async-storage";

import { DEFAULT_SETTINGS, parseStoredSettings } from "./settings";

import type { AppSettings } from "./settings";

/** Storage key; the suffix is the version of the stored shape. */
export const SETTINGS_STORAGE_KEY = "pica.settings.v1";

/**
 * Loads the settings from the device.
 *
 * @returns The stored settings, or the defaults when nothing usable is stored
 * or the storage cannot be read.
 */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);

    if (stored === null) {
      return DEFAULT_SETTINGS;
    }

    return parseStoredSettings(JSON.parse(stored));
  } catch (error: unknown) {
    console.warn("[pica] The settings could not be read.", error);

    return DEFAULT_SETTINGS;
  }
}

/**
 * Stores the settings on the device.
 *
 * @param settings - The complete settings to keep.
 * @returns Whether the settings were stored.
 */
export async function saveSettings(settings: AppSettings): Promise<boolean> {
  try {
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));

    return true;
  } catch (error: unknown) {
    console.warn("[pica] The settings could not be saved.", error);

    return false;
  }
}
