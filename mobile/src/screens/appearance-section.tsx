import { useTranslation } from "react-i18next";

import { OptionGroup } from "@/components/option-group";
import { SettingsSection } from "@/components/settings-section";
import { useSettings } from "@/settings/settings-provider";

import type { LanguagePreference } from "@/i18n/language";
import type { ThemePreference } from "@/theme/theme-provider";

/** The theme and the language of the app. */
export function AppearanceSection(): React.ReactElement {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();

  const themeOptions: readonly { value: ThemePreference; label: string }[] = [
    { value: "system", label: t("settings.themeOptions.system") },
    { value: "light", label: t("settings.themeOptions.light") },
    { value: "dark", label: t("settings.themeOptions.dark") },
  ];
  const languageOptions: readonly {
    value: LanguagePreference;
    label: string;
  }[] = [
    { value: "system", label: t("settings.languageOptions.system") },
    { value: "de", label: t("settings.languageOptions.de") },
    { value: "en", label: t("settings.languageOptions.en") },
  ];

  return (
    <SettingsSection title={t("settings.appearanceTitle")}>
      <OptionGroup
        label={t("settings.theme")}
        onChange={(theme) => updateSettings({ theme })}
        options={themeOptions}
        value={settings.theme}
      />
      <OptionGroup
        label={t("settings.language")}
        onChange={(language) => updateSettings({ language })}
        options={languageOptions}
        value={settings.language}
      />
    </SettingsSection>
  );
}
