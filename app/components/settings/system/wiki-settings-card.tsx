import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

import {
  ControlRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";
import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

import type { WikiSettings } from "@/definition/Wiki";

interface WikiSettingsCardProps {
  readonly settings: WikiSettings;
}

const MEBIBYTE = 1024 * 1024;

const FIELDS = [
  {
    name: "trashRetentionDays",
    read: (s: WikiSettings) => s.trashRetentionDays,
  },
  {
    name: "versionRetentionDays",
    read: (s: WikiSettings) => s.versionRetentionDays,
  },
  { name: "versionKeepLast", read: (s: WikiSettings) => s.versionKeepLast },
  {
    name: "mediaLimitMegabytes",
    read: (s: WikiSettings) => Math.round(s.mediaLimitBytes / MEBIBYTE),
  },
  {
    name: "fileLimitMegabytes",
    read: (s: WikiSettings) => Math.round(s.fileLimitBytes / MEBIBYTE),
  },
] as const;

/** Retention of trash and versions, and the upload limits of the wiki. */
export function WikiSettingsCard({
  settings,
}: WikiSettingsCardProps): React.ReactElement {
  const { t } = useTranslation();
  const outcome = useActionOutcome("update-wiki-settings");
  const navigation = useNavigation();
  const isSaving =
    navigation.formData?.get("intent") === "update-wiki-settings";

  return (
    <SettingsCard
      description={t("settings.system.wiki.description")}
      icon={<BookOpen className="size-4" aria-hidden="true" />}
      title={t("settings.system.wiki.title")}
    >
      <Form className="space-y-3" method="post" noValidate>
        <input name="intent" type="hidden" value="update-wiki-settings" />
        {FIELDS.map((field) => (
          <ControlRow
            key={field.name}
            label={t(`settings.system.wiki.${field.name}`)}
          >
            <Input
              key={field.read(settings)}
              aria-label={t(`settings.system.wiki.${field.name}`)}
              defaultValue={field.read(settings)}
              inputMode="numeric"
              name={field.name}
            />
          </ControlRow>
        ))}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.system.wiki.hint")}
        </p>
        <Button disabled={isSaving} type="submit">
          {t("settings.system.wiki.save")}
        </Button>
        {outcome?.ok === true ? (
          <p className="text-sm text-success" role="status">
            {t("settings.system.wiki.saved")}
          </p>
        ) : null}
        {outcome?.ok === false ? (
          <p className="text-sm text-destructive" role="alert">
            {t(`settings.system.wiki.error.${outcome.error}`)}
          </p>
        ) : null}
      </Form>
    </SettingsCard>
  );
}
