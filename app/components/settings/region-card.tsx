import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ControlRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";
import { Select } from "@/app/components/ui/select";
import { formatTimezoneOffset } from "@/app/lib/timezone";
import { USER_DATE_FORMATS, USER_TIMEZONES } from "@/definition/Settings";
import { LANGUAGE } from "@/language/Language";

import type { UserSettings, UserTimezone } from "@/definition/Settings";

interface RegionCardProps {
  readonly settings: UserSettings;
  readonly onChange: (patch: Partial<UserSettings>) => void;
}

/** Renders the language, time zone, date format, and week start selectors. */
export function RegionCard({
  settings,
  onChange,
}: RegionCardProps): React.ReactElement {
  const { t } = useTranslation();

  const timezoneOptions: {
    value: UserTimezone | "";
    label: string;
    description?: string;
  }[] = [
    {
      value: "",
      label: t("settings.region.timezoneNotSet"),
    },
    ...USER_TIMEZONES.map((timeZone) => ({
      value: timeZone,
      label: timeZone,
      description: formatTimezoneOffset(timeZone),
    })),
  ];

  function handleTimezoneChange(timezone: UserTimezone | ""): void {
    onChange({ timezone: timezone === "" ? null : timezone });
  }

  return (
    <SettingsCard
      description={t("settings.region.description")}
      icon={<Globe className="size-4" aria-hidden="true" />}
      title={t("settings.region.title")}
    >
      <div className="flex flex-col gap-4">
        <ControlRow label={t("settings.region.language")}>
          <Select
            ariaLabel={t("settings.region.language")}
            className="w-full"
            onValueChange={(language) => onChange({ language })}
            options={[
              {
                value: LANGUAGE.GERMAN,
                label: t("settings.language.de"),
              },
              {
                value: LANGUAGE.ENGLISH,
                label: t("settings.language.en"),
              },
            ]}
            value={settings.language}
          />
        </ControlRow>
        <ControlRow label={t("settings.region.timezone")}>
          <Select
            ariaLabel={t("settings.region.timezone")}
            className="w-full"
            onValueChange={handleTimezoneChange}
            options={timezoneOptions}
            value={settings.timezone ?? ""}
          />
        </ControlRow>
        <ControlRow label={t("settings.region.dateFormat")}>
          <Select
            ariaLabel={t("settings.region.dateFormat")}
            className="w-full"
            onValueChange={(dateFormat) => onChange({ dateFormat })}
            options={USER_DATE_FORMATS.map((dateFormat) => ({
              value: dateFormat,
              label: dateFormat,
            }))}
            value={settings.dateFormat}
          />
        </ControlRow>
        <ControlRow label={t("settings.region.weekStart")}>
          <Select
            ariaLabel={t("settings.region.weekStart")}
            className="w-full"
            onValueChange={(weekStart) => onChange({ weekStart })}
            options={[
              {
                value: "monday",
                label: t("settings.region.weekStartMonday"),
              },
              {
                value: "sunday",
                label: t("settings.region.weekStartSunday"),
              },
            ]}
            value={settings.weekStart}
          />
        </ControlRow>
      </div>
    </SettingsCard>
  );
}
