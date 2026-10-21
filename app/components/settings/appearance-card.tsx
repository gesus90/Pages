import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ControlRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";
import { DesignThemePicker } from "@/app/components/settings/design-theme-picker";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { USER_THEMES } from "@/definition/Settings";

import type { SegmentedControlOption } from "@/app/components/ui/segmented-control";
import type { DesignThemeSelection } from "@/definition/DesignTheme";
import type { UserSettings, UserTheme } from "@/definition/Settings";

const THEME_ICONS = {
  dark: <Moon className="size-3.5" aria-hidden="true" />,
  light: <Sun className="size-3.5" aria-hidden="true" />,
  system: <Monitor className="size-3.5" aria-hidden="true" />,
} as const satisfies Record<UserTheme, React.ReactElement>;

interface AppearanceCardProps {
  readonly settings: UserSettings;
  readonly designThemes: DesignThemeSelection;
  readonly onChange: (patch: Partial<UserSettings>) => void;
}

/**
 * Renders the choice between the light, the dark and the system theme, and
 * below it the choice of the design theme.
 */
export function AppearanceCard({
  settings,
  designThemes,
  onChange,
}: AppearanceCardProps): React.ReactElement {
  const { t } = useTranslation();

  const options: SegmentedControlOption<UserTheme>[] = USER_THEMES.map(
    (theme) => ({
      icon: THEME_ICONS[theme],
      label: t(`settings.appearance.${theme}`),
      value: theme,
    }),
  );

  return (
    <SettingsCard
      description={t("settings.appearance.description")}
      icon={<Palette className="size-4" aria-hidden="true" />}
      title={t("settings.appearance.title")}
    >
      <div className="flex flex-col gap-4">
        <ControlRow label={t("settings.appearance.theme")}>
          <SegmentedControl
            ariaLabel={t("settings.appearance.theme")}
            onValueChange={(theme) => onChange({ theme })}
            options={options}
            value={settings.theme}
          />
        </ControlRow>
        <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("settings.appearance.systemHint")}
        </p>
        <DesignThemePicker selection={designThemes} />
      </div>
    </SettingsCard>
  );
}
