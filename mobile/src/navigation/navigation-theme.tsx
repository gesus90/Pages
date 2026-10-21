import { DefaultTheme, ThemeProvider } from "expo-router";

import { useTheme } from "@/theme/theme-provider";

import type { ReactNode } from "react";

interface NavigationThemeProps {
  readonly children: ReactNode;
}

/** Hands the theme tokens to the navigation: headers, tab bar and backgrounds. */
export function NavigationTheme({
  children,
}: NavigationThemeProps): React.ReactElement {
  const { scheme, colors } = useTheme();

  return (
    <ThemeProvider
      value={{
        dark: scheme === "dark",
        colors: {
          primary: colors.primary,
          background: colors.background,
          card: colors.surface,
          text: colors.foreground,
          border: colors.border,
          notification: colors.primary,
        },
        fonts: DefaultTheme.fonts,
      }}
    >
      {children}
    </ThemeProvider>
  );
}
