import { useLocales } from "expo-localization";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ConnectionProvider } from "@/connection/connection-provider";
import { I18nProvider } from "@/i18n/i18n-provider";
import { resolveLanguage } from "@/i18n/language";
import { NavigationTheme } from "@/navigation/navigation-theme";
import { SettingsProvider, useSettings } from "@/settings/settings-provider";
import { ThemeProvider } from "@/theme/theme-provider";

import type { ReactNode } from "react";

interface AppProvidersProps {
  readonly children: ReactNode;
}

function PreferenceProviders({
  children,
}: AppProvidersProps): React.ReactElement {
  const { settings } = useSettings();
  const locales = useLocales();
  const language = resolveLanguage(settings.language, locales[0]?.languageCode);

  return (
    <ThemeProvider preference={settings.theme}>
      <I18nProvider language={language}>
        <NavigationTheme>
          <ConnectionProvider>{children}</ConnectionProvider>
        </NavigationTheme>
      </I18nProvider>
    </ThemeProvider>
  );
}

/**
 * Every provider the screens read from, in the order they depend on each other:
 * safe-area insets, the stored settings, then theme, language and connection,
 * which follow the settings.
 */
export function AppProviders({
  children,
}: AppProvidersProps): React.ReactElement {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <PreferenceProviders>{children}</PreferenceProviders>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
