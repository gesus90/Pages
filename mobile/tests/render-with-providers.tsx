import { render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "@/i18n/i18n-provider";
import { ThemeProvider } from "@/theme/theme-provider";

import type { ReactElement } from "react";
import type { Language } from "@/i18n/language";
import type { ThemePreference } from "@/theme/theme-provider";

interface RenderOptions {
  readonly language?: Language;
  readonly theme?: ThemePreference;
}

const INITIAL_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** Renders a component with the theme, the language and safe-area metrics. */
export function renderWithProviders(
  ui: ReactElement,
  { language = "en", theme = "light" }: RenderOptions = {},
): ReturnType<typeof render> {
  return render(
    <SafeAreaProvider initialMetrics={INITIAL_METRICS}>
      <ThemeProvider preference={theme}>
        <I18nProvider language={language}>{ui}</I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}
