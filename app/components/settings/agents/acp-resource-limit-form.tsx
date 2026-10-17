import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { ControlRow } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { MAX_ACP_SESSIONS } from "@/definition/AcpResource";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";
import type { AcpResourceSnapshot } from "@/definition/AcpResource";

interface AcpResourceLimitFormProps {
  readonly resources: AcpResourceSnapshot;
  readonly onApplied: (snapshot: AcpResourceSnapshot) => void;
}

/** Edits the shared limit and acknowledges only server-confirmed persistence and application. */
export function AcpResourceLimitForm({
  resources,
  onApplied,
}: AcpResourceLimitFormProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<SettingsActionData>();
  const lastApplied = useRef<SettingsActionData | undefined>(undefined);
  const outcome =
    fetcher.data?.intent === "update-acp-resources" ? fetcher.data : null;
  const isSaving = fetcher.state !== "idle";
  const isEnvironment = resources.limitSource === "environment";
  const isDisabled = isSaving || isEnvironment;
  useEffect(() => {
    if (!outcome?.ok || lastApplied.current === outcome) return;
    lastApplied.current = outcome;
    onApplied(outcome.resources);
  }, [outcome, onApplied]);

  return (
    <fetcher.Form
      method="post"
      action="/settings/system"
      noValidate
      aria-busy={isSaving}
    >
      <input type="hidden" name="intent" value="update-acp-resources" />
      <ControlRow label={t("settings.agents.resources.limitLabel")}>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            key={resources.options.maxConcurrentAcpSessions}
            className="w-24"
            name="maxConcurrentAcpSessions"
            type="number"
            min={0}
            max={MAX_ACP_SESSIONS}
            step={1}
            required
            inputMode="numeric"
            defaultValue={resources.options.maxConcurrentAcpSessions}
            disabled={isDisabled}
            aria-label={t("settings.agents.resources.limitLabel")}
            aria-describedby="acp-limit-hint acp-limit-source"
            aria-invalid={outcome?.ok === false ? true : undefined}
          />
          <Button type="submit" disabled={isDisabled}>
            {t(`settings.agents.resources.${isSaving ? "saving" : "save"}`)}
          </Button>
        </div>
      </ControlRow>
      <p id="acp-limit-hint" className="mt-3 text-xs text-muted-foreground">
        {t("settings.agents.resources.limitHint")}
      </p>
      <p id="acp-limit-source" className="mt-2 text-xs text-muted-foreground">
        {t(
          `settings.agents.resources.${isEnvironment ? "environmentHint" : "applyHint"}`,
        )}
      </p>
      {isSaving ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {t("settings.agents.resources.saving")}
        </p>
      ) : null}
      {!isSaving && outcome?.ok === true ? (
        <p role="status" className="mt-2 text-sm text-success">
          {t("settings.agents.resources.saved")}
        </p>
      ) : null}
      {!isSaving && outcome?.ok === false ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t(`settings.agents.resources.error.${outcome.error}`)}
        </p>
      ) : null}
    </fetcher.Form>
  );
}
