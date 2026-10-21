import { createContext, useContext, useEffect, useState } from "react";

import { DEFAULT_SETTINGS, mergeSettings } from "./settings";
import { loadSettings, saveSettings } from "./settings-storage";

import type { ReactNode } from "react";
import type { AppSettings } from "./settings";

interface SettingsContextValue {
  readonly settings: AppSettings;
  readonly updateSettings: (changes: Partial<AppSettings>) => void;
}

interface SettingsProviderProps {
  /** Rendered once the stored settings are known. */
  readonly children: ReactNode;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => undefined,
});

/**
 * Loads the settings from the device and shares them with the app.
 *
 * @remarks
 * Nothing below the provider renders before the stored settings are known, so
 * the first frame already shows the chosen theme and language.
 */
export function SettingsProvider({
  children,
}: SettingsProviderProps): React.ReactElement | null {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    let isCurrent = true;

    void loadSettings().then((loaded) => {
      if (isCurrent) {
        setSettings(loaded);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, []);

  if (settings === null) {
    return null;
  }

  const updateSettings = (changes: Partial<AppSettings>): void => {
    const next = mergeSettings(settings, changes);

    setSettings(next);
    void saveSettings(next);
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * Returns the settings and the function that changes them.
 *
 * @returns The current settings and `updateSettings`, which keeps the change on
 * the device.
 */
export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
