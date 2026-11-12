import { Activity } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  AGENT_RUN_LOG_RETENTION_RANGE,
  AGENT_RUN_STALL_MINUTES_RANGE,
} from "@/definition/AgentRunDiagnosis";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { AgentRunDiagnosisSettings } from "@/definition/AgentRunDiagnosis";

function SaveFeedback({
  result,
}: {
  readonly result: AgentActionResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (result === undefined) return null;
  if (result.ok)
    return result.intent === "save-run-diagnosis" ? (
      <p role="status" className="text-sm text-success">
        {t("runDiagnosis.settings.saved")}
      </p>
    ) : null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t([`settings.agents.error.${result.error}`, "chat.error.general"])}
    </p>
  );
}

function NumberField({
  name,
  label,
  hint,
  range,
  defaultValue,
  isDisabled,
}: {
  readonly name: string;
  readonly label: string;
  readonly hint: string;
  readonly range: { readonly minimum: number; readonly maximum: number };
  readonly defaultValue: number;
  readonly isDisabled: boolean;
}): React.ReactElement {
  const id = useId();
  return (
    <div className="max-w-xs">
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-foreground"
      >
        {label}
      </label>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        min={range.minimum}
        max={range.maximum}
        defaultValue={defaultValue}
        disabled={isDisabled}
        required
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * The diagnosis of plan runs under Settings → Agents (PAGE-307): how long
 * logs and failure records are kept and after how many minutes without a new
 * event a step counts as stalled.
 */
export function RunDiagnosisSettingsCard({
  settings,
}: {
  readonly settings: AgentRunDiagnosisSettings;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>({
    key: "run-diagnosis-settings",
  });
  const isPending = fetcher.state !== "idle";
  return (
    <SettingsCard
      icon={<Activity className="size-4" />}
      title={t("runDiagnosis.settings.title")}
      description={t("runDiagnosis.settings.description")}
    >
      <fetcher.Form key={settings.revision} method="post" className="space-y-4">
        <input type="hidden" name="intent" value="save-run-diagnosis" />
        <input type="hidden" name="revision" value={settings.revision} />
        <NumberField
          name="logRetentionDays"
          label={t("runDiagnosis.settings.retention")}
          hint={t("runDiagnosis.settings.retentionHint", {
            ...AGENT_RUN_LOG_RETENTION_RANGE,
          })}
          range={AGENT_RUN_LOG_RETENTION_RANGE}
          defaultValue={settings.logRetentionDays}
          isDisabled={isPending}
        />
        <NumberField
          name="stallMinutes"
          label={t("runDiagnosis.settings.stall")}
          hint={t("runDiagnosis.settings.stallHint", {
            ...AGENT_RUN_STALL_MINUTES_RANGE,
          })}
          range={AGENT_RUN_STALL_MINUTES_RANGE}
          defaultValue={settings.stallMinutes}
          isDisabled={isPending}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SaveFeedback result={isPending ? undefined : fetcher.data} />
          <Button type="submit" size="sm" disabled={isPending}>
            {t("settings.agents.save")}
          </Button>
        </div>
      </fetcher.Form>
    </SettingsCard>
  );
}
