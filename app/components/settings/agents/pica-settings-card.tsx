import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { PicaMascot } from "@/app/components/chat/pica-mascot";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { PicaAdministration } from "@/definition/PicaSettings";
import type { FetcherWithComponents } from "react-router";

interface PicaSettingsCardProps {
  readonly settings: PicaAdministration;
  readonly models: readonly PageAgentModel[];
}

/** The fixed chat identity above the independently managed API and CLI connections. */
export function PicaSettingsCard({
  settings,
  models,
}: PicaSettingsCardProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>({ key: "pica-settings" });
  return (
    <SettingsCard
      icon={<PicaMascot className="size-7" />}
      title={t("picaSettings.title")}
      description={t("picaSettings.description")}
    >
      <PicaSettingsForm
        key={settings.revision}
        settings={settings}
        models={models}
        fetcher={fetcher}
      />
    </SettingsCard>
  );
}

function PicaSettingsForm({
  settings,
  models,
  fetcher,
}: PicaSettingsCardProps & {
  readonly fetcher: FetcherWithComponents<AgentActionResult>;
}): React.ReactElement {
  const { t } = useTranslation();
  const {
    isEnabled,
    setEnabled,
    modelKey,
    effort,
    setEffort,
    selectModel,
    selection,
    hasResetEffort,
  } = usePicaDraft(settings, models);
  const isPending = fetcher.state !== "idle";
  const error = fetcher.data?.ok === false ? fetcher.data.error : null;
  return (
    <fetcher.Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="save-pica" />
      <input type="hidden" name="revision" value={settings.revision} />
      <input type="hidden" name="isEnabled" value={String(isEnabled)} />
      <input
        type="hidden"
        name="modelConnectionId"
        value={selection?.connectionId ?? ""}
      />
      <input type="hidden" name="model" value={selection?.model ?? ""} />
      <input type="hidden" name="reasoningEffort" value={effort} />
      <div className="flex items-center justify-between gap-4">
        <span id="pica-enable-label" className="text-sm font-medium">
          {t("picaSettings.enable")}
        </span>
        <Select
          ariaLabel={t("picaSettings.enable")}
          disabled={isPending}
          value={String(isEnabled)}
          options={[
            { value: "false", label: t("picaSettings.off") },
            { value: "true", label: t("picaSettings.on") },
          ]}
          onValueChange={(choice) => setEnabled(choice === "true")}
        />
      </div>
      <PicaModelFields
        models={models}
        modelKey={modelKey}
        effort={effort}
        savedModel={settings.selection?.model ?? ""}
        disabled={!isEnabled || isPending}
        onModel={selectModel}
        onEffort={setEffort}
      />
      <PicaSelectionNotice
        settings={settings}
        hasResetEffort={hasResetEffort}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("picaSettings.stopHint")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={isPending}>
          {t("settings.agents.save")}
        </Button>
        {fetcher.data?.ok && !isPending ? (
          <p role="status" className="text-sm text-success">
            {t("picaSettings.saved")}
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t([
            `chat.error.${error}`,
            `settings.agents.error.${error}`,
            "chat.error.general",
          ])}
        </p>
      ) : null}
    </fetcher.Form>
  );
}

interface PicaModelFieldsProps {
  readonly models: readonly PageAgentModel[];
  readonly modelKey: string;
  readonly savedModel: string;
  readonly effort: string;
  readonly disabled: boolean;
  readonly onModel: (key: string) => void;
  readonly onEffort: (effort: string) => void;
}

function PicaModelFields(props: PicaModelFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const model = props.models.find((entry) => entry.id === props.modelKey);
  const efforts = model?.reasoningEfforts ?? [];
  const missingEffort = props.effort && !efforts.includes(props.effort);
  const modelOptions = props.models.map((entry) => ({
    value: entry.id,
    label: entry.name,
    description: `${t(`settings.agents.provider.${entry.provider}`)}${entry.isManual ? ` · ${t("picaSettings.manual")}` : ""}`,
  }));
  if (!model)
    modelOptions.unshift({
      value: props.modelKey,
      label: props.savedModel
        ? `${props.savedModel} · ${t("pageAgents.missingModel")}`
        : t("picaSettings.chooseModel"),
      description: "",
    });
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <label htmlFor={`${id}-model`} className="text-sm font-medium">
          {t("pageAgents.model")}
        </label>
        <Select
          id={`${id}-model`}
          ariaLabel={t("pageAgents.model")}
          value={props.modelKey}
          onValueChange={props.onModel}
          disabled={props.disabled}
          options={modelOptions}
          className="w-full border border-border [&>span]:min-w-0 [&>span]:truncate"
        />
      </div>
      <div className="min-w-0 space-y-2">
        <label htmlFor={`${id}-reasoning`} className="text-sm font-medium">
          {t("pageAgents.reasoning")}
        </label>
        <Select
          id={`${id}-reasoning`}
          ariaLabel={t("pageAgents.reasoning")}
          value={props.effort}
          onValueChange={props.onEffort}
          disabled={props.disabled || efforts.length === 0}
          options={[
            { value: "", label: t("pageAgents.defaultReasoning") },
            ...efforts.map((effort) => ({ value: effort, label: effort })),
            ...(missingEffort
              ? [
                  {
                    value: props.effort,
                    label: `${props.effort}${model ? ` · ${t("picaSettings.unsupportedEffort")}` : ""}`,
                    disabled: true,
                  },
                ]
              : []),
          ]}
          className="w-full border border-border [&>span]:truncate"
        />
        {model && efforts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("settings.agents.assignments.noEffort")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface PicaDraft {
  readonly isEnabled: boolean;
  readonly setEnabled: (enabled: boolean) => void;
  readonly modelKey: string;
  readonly effort: string;
  readonly setEffort: (effort: string) => void;
  readonly selectModel: (key: string) => void;
  readonly selection: PageAgentModel | PicaAdministration["selection"];
  readonly hasResetEffort: boolean;
}

function usePicaDraft(
  settings: PicaAdministration,
  models: readonly PageAgentModel[],
): PicaDraft {
  const [isEnabled, setEnabled] = useState(settings.isEnabled);
  const [modelKey, setModelKey] = useState(
    settings.selection
      ? agentModelKey(settings.selection.connectionId, settings.selection.model)
      : "",
  );
  const [effort, setEffort] = useState(
    settings.selection?.reasoningEffort ?? "",
  );
  const [hasResetEffort, setResetEffort] = useState(false);
  const model = models.find((entry) => entry.id === modelKey);
  const selection = model ?? settings.selection;
  function selectModel(key: string): void {
    const next = models.find((entry) => entry.id === key);
    if (effort && !next?.reasoningEfforts.includes(effort)) {
      setEffort("");
      setResetEffort(true);
    }
    setModelKey(key);
  }

  return {
    isEnabled,
    setEnabled,
    modelKey,
    effort,
    setEffort,
    selectModel,
    selection,
    hasResetEffort,
  };
}

function PicaSelectionNotice({
  settings,
  hasResetEffort,
}: {
  readonly settings: PicaAdministration;
  readonly hasResetEffort: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {hasResetEffort ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("picaSettings.effortReset")}
        </p>
      ) : null}
      {settings.error ? (
        <p role="status" className="text-sm text-warning">
          {t("picaSettings.unavailable")}{" "}
          {t([
            `chat.error.${settings.error}`,
            `settings.agents.error.${settings.error}`,
          ])}
        </p>
      ) : null}
    </>
  );
}
