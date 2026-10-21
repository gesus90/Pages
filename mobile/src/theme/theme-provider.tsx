import { createContext, useContext, useEffect } from "react";
import { Appearance, useColorScheme } from "react-native";
import * as SystemUI from "expo-system-ui";

import { PALETTES } from "./tokens";

import type { ReactNode } from "react";
import type { ColorScheme, ThemeColors } from "./tokens";

/** How the person chose the color scheme: follow the device or force one. */
export type ThemePreference = "system" | ColorScheme;

/** The resolved theme every component reads. */
export interface Theme {
  readonly scheme: ColorScheme;
  readonly colors: ThemeColors;
}

interface ThemeProviderProps {
  readonly preference: ThemePreference;
  readonly children: ReactNode;
}

function resolveDeviceScheme(
  deviceScheme: string | null | undefined,
): ColorScheme {
  return deviceScheme === "dark" ? "dark" : "light";
}

const ThemeContext = createContext<Theme>({
  scheme: "light",
  colors: PALETTES.light,
});

/**
 * Provides the theme for the chosen preference.
 *
 * @remarks
 * A forced scheme is handed to the operating system through `Appearance`, so
 * the status bar, the keyboard and system dialogs follow it as well; `unspecified`
 * returns control to the device. The window background follows the palette so
 * no white edge shows while the keyboard or the orientation changes.
 */
export function ThemeProvider({
  preference,
  children,
}: ThemeProviderProps): React.ReactElement {
  const deviceScheme = useColorScheme();
  const scheme: ColorScheme =
    preference === "system" ? resolveDeviceScheme(deviceScheme) : preference;
  const colors = PALETTES[scheme];

  useEffect(() => {
    Appearance.setColorScheme(
      preference === "system" ? "unspecified" : preference,
    );
  }, [preference]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(
      (error: unknown) => {
        console.warn("[pica] The window background could not be set.", error);
      },
    );
  }, [colors.background]);

  return (
    <ThemeContext.Provider value={{ scheme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Returns the theme of the nearest provider.
 *
 * @returns The color scheme and its semantic colors.
 */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}
