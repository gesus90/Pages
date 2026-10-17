import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

import {
  ControlRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";
import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

import type { LoggingStatus } from "@/definition/Logging";

interface LoggingCardProps {
  readonly retentionDays: number;
  readonly status: LoggingStatus;
}

/** Renders live instance retention, its deletion effect, and administrator-only writer health. */
export function LoggingCard({
  retentionDays,
  status,
}: LoggingCardProps): React.ReactElement {
  const { t } = useTranslation();
  const outcome = useActionOutcome("update-logging");
  const navigation = useNavigation();
  const isSaving = navigation.formData?.get("intent") === "update-logging";
  const currentDays =
    outcome?.ok === true ? outcome.retentionDays : retentionDays;
  const savedRetention =
    currentDays === 0
      ? t("settings.system.logging.unlimited")
      : t("settings.system.logging.retained", { count: currentDays });
  return (
    <SettingsCard
      title={t("settings.system.logging.title")}
      description={t("settings.system.logging.description")}
      icon={<FileText className="size-4" aria-hidden="true" />}
    >
      <Form method="post" noValidate>
        <input type="hidden" name="intent" value="update-logging" />
        <ControlRow label={t("settings.system.logging.label")}>
          <div className="flex items-center gap-2">
            <Input
              key={currentDays}
              name="logRetentionDays"
              defaultValue={currentDays}
              inputMode="numeric"
              aria-label={t("settings.system.logging.label")}
              aria-describedby="log-retention-hint"
              aria-invalid={outcome?.ok === false ? true : undefined}
            />
            <Button type="submit" disabled={isSaving}>
              {t("settings.system.logging.save")}
            </Button>
          </div>
        </ControlRow>
        <p
          className="mt-3 text-xs leading-relaxed text-muted-foreground"
          id="log-retention-hint"
        >
          {t("settings.system.logging.hint")}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.system.logging.currentlySaved", {
            retention: savedRetention,
          })}
        </p>
        {outcome?.ok === true ? (
          <p className="mt-2 text-sm text-success" role="status">
            {t("settings.system.logging.saved")}
          </p>
        ) : null}
        {outcome?.ok === false ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {t(`settings.system.logging.error.${outcome.error}`)}
          </p>
        ) : null}
        {status.state === "degraded" ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {t("settings.system.logging.degraded", {
              code: status.failureCode ?? "LOG_LOSS",
              count: status.lostEntries,
              pending: status.queuedEntries,
            })}
          </p>
        ) : null}
      </Form>
    </SettingsCard>
  );
}
