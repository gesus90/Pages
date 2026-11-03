import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { ModelPicker } from "@/app/components/agents/model-picker";
import {
  ModelCatalogRefreshContext,
  useModelCatalogRefresh,
} from "@/app/components/agents/model-picker/use-model-catalog-refresh";
import { PicaMascot } from "@/app/components/chat/pica-mascot";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { reasoningOptions } from "@/app/lib/reasoning-options";
import {
  findSavedModel,
  isClaudeModelAlias,
} from "@/definition/AgentModelVersion";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";
import { modelsOfSameTarget } from "@/definition/AgentReasoningChoice";

import type { ModelCatalogRefresh } from "@/app/components/agents/model-picker/use-model-catalog-refresh";
import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { PicaAdministration } from "@/definition/PicaSettings";
import type { FetcherWithComponents } from "react-router";

interface PicaSettingsCardProps {
  readonly settings: PicaAdministration;
  readonly models: readonly PageAgentModel[];
}

/**
 * The fixed chat identity alongside the independently managed agent connections.
 *
 * @remarks
 * The model choice is the shared one of Pages, fed with the models of the
 * shared catalog that Pica can run. The page's refresh channel checks for a
 * changed catalog on focus, on opening the choice and while the page is
 * visible; a refresh never changes the saved choice or the draft.
 */
export function PicaSettingsCard({
  settings,
  models,
  catalogRefresh,
}: PicaSettingsCardProps & {
  /** The marker of Pica's model projection; without it the models stay as loaded. */
  readonly catalogRefresh?: ModelCatalogRefresh;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>({ key: "pica-settings" });
  const refresh = useModelCatalogRefresh(catalogRefresh);
  return (
    <SettingsCard
      icon={<PicaMascot className="size-7" />}
      title={t("picaSettings.title")}
      description={t("picaSettings.description")}
    >
      <ModelCatalogRefreshContext value={refresh}>
        <PicaSettingsForm
          key={settings.revision}
          settings={settings}
          models={models}
          fetcher={fetcher}
        />
      </ModelCatalogRefreshContext>
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
    aliasNotice,
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
      <PicaTarget />
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
        aliasNotice={aliasNotice}
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

// Pica runs on this host only; the target stands once above the model choice.
function PicaTarget(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm">
      <span className="text-muted-foreground">{t("picaSettings.target")}</span>
      <span className="font-semibold">{t("picaSettings.targetLocal")}</span>
    </p>
  );
}

function PicaModelFields(props: PicaModelFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const model = props.models.find((entry) => entry.id === props.modelKey);
  const efforts = model?.reasoningEfforts ?? [];
  const effortOptions = reasoningOptions({
    model,
    modelName: model?.modelName ?? model?.name ?? "",
    siblings: modelsOfSameTarget(props.models, model),
    current: props.effort,
    defaultLabel: t("pageAgents.defaultReasoning"),
    translate: t,
  });
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <ModelPicker
        value={props.modelKey}
        models={props.models}
        savedModel={props.savedModel}
        disabled={props.disabled}
        placeholder={t("picaSettings.chooseModel")}
        onChange={props.onModel}
      />
      <div className="min-w-0 space-y-2">
        <label htmlFor={`${id}-reasoning`} className="text-sm font-medium">
          {t("pageAgents.reasoning")}
        </label>
        <Select
          id={`${id}-reasoning`}
          ariaLabel={t("pageAgents.reasoning")}
          value={props.effort}
          onValueChange={props.onEffort}
          disabled={props.disabled || effortOptions.length === 1}
          options={effortOptions}
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

/** What the notice below the model choice says about a saved Claude family alias. */
type AliasNotice =
  | {
      readonly kind: "resolved";
      readonly alias: string;
      readonly model: PageAgentModel;
    }
  | { readonly kind: "unresolved"; readonly alias: string };

/** The key the saved selection starts on, and what to tell about an alias it was stored under. */
interface SavedChoice {
  readonly key: string;
  readonly notice: AliasNotice | null;
}

function savedChoice(
  selection: PicaAdministration["selection"],
  models: readonly PageAgentModel[],
): SavedChoice {
  if (!selection) return { key: "", notice: null };
  const match = findSavedModel(models, selection);
  if (match)
    return {
      key: match.model.id,
      notice:
        match.alias === null
          ? null
          : { kind: "resolved", alias: match.alias, model: match.model },
    };
  const provider = models.find(
    (entry) => entry.connectionId === selection.connectionId,
  )?.provider;
  return {
    key: agentModelKey(selection.connectionId, selection.model),
    notice:
      provider === "claude_code" && isClaudeModelAlias(selection.model)
        ? { kind: "unresolved", alias: selection.model }
        : null,
  };
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
  /** The alias note, only while the choice still is the saved one. */
  readonly aliasNotice: AliasNotice | null;
}

function usePicaDraft(
  settings: PicaAdministration,
  models: readonly PageAgentModel[],
): PicaDraft {
  const [isEnabled, setEnabled] = useState(settings.isEnabled);
  const saved = savedChoice(settings.adoption ?? settings.selection, models);
  const [modelKey, setModelKey] = useState(saved.key);
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
    aliasNotice: modelKey === saved.key ? saved.notice : null,
  };
}

function PicaSelectionNotice({
  settings,
  hasResetEffort,
  aliasNotice,
}: {
  readonly settings: PicaAdministration;
  readonly hasResetEffort: boolean;
  readonly aliasNotice: AliasNotice | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {settings.adoption ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("picaSettings.apiAdoption", { model: settings.adoption.model })}
        </p>
      ) : null}
      {aliasNotice?.kind === "resolved" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("picaSettings.aliasResolved", {
            alias: aliasNotice.alias,
            model: aliasNotice.model.modelName ?? aliasNotice.model.name,
            id: aliasNotice.model.model,
          })}
        </p>
      ) : null}
      {aliasNotice?.kind === "unresolved" ? (
        <p role="status" className="text-sm text-warning">
          {t("picaSettings.aliasUnresolved", { alias: aliasNotice.alias })}
        </p>
      ) : null}
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
