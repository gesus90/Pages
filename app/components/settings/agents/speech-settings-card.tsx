import { Mic } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { ModelPicker } from "@/app/components/agents/model-picker";
import {
  MODEL_FIELD_CLASS,
  MODEL_FIELD_LABEL_CLASS,
} from "@/app/components/agents/model-picker/model-field";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import { consumerModels } from "@/definition/AgentModelConsumers";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";
import {
  effectiveSpeechDuration,
  SPEECH_DURATION_CHOICES,
} from "@/definition/SpeechRecognition";

import {
  SpeechStatusBadge,
  SpeechUnsuitableNote,
  formatSpeechDuration,
} from "./speech-settings/speech-status";
import { SpeechTestResult, useSpeechTest } from "./speech-settings/speech-test";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { SpeechAdministration } from "@/definition/SpeechRecognition";
import type { FetcherWithComponents } from "react-router";
import type { SpeechTest } from "./speech-settings/speech-test";

interface SpeechSettingsCardProps {
  readonly administration: SpeechAdministration;
  /** Whether the last server refresh of a catalog failed; the model choice then warns. */
  readonly isCatalogFailed?: boolean;
}

/**
 * The speech recognition (STT) of the instance (PAGE-273), above Pica.
 *
 * @remarks
 * The model choice is the shared one of Pages, fed only with the speech
 * models of the instance by the central rule `stt` of
 * `modelConsumerRefusal`. There is no language choice: the model recognizes
 * the language itself. A test recording uses the saved setting.
 */
export function SpeechSettingsCard({
  administration,
  isCatalogFailed,
}: SpeechSettingsCardProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>({ key: "speech-settings" });
  return (
    <SettingsCard
      icon={<Mic className="size-4" />}
      title={t("speechSettings.title")}
      description={t("speechSettings.description")}
      action={
        administration.isSimulation ? (
          <span className="rounded-md bg-warning-subtle px-2 py-1 text-xs font-semibold text-warning">
            {t("speechSettings.simulation")}
          </span>
        ) : null
      }
    >
      <SpeechSettingsForm
        key={administration.settings.revision}
        administration={administration}
        isCatalogFailed={isCatalogFailed === true}
        fetcher={fetcher}
      />
    </SettingsCard>
  );
}

interface SpeechDraft {
  readonly modelKey: string;
  readonly setModelKey: (key: string) => void;
  readonly maxDurationMs: number;
  readonly setMaxDurationMs: (duration: number) => void;
  readonly selection: {
    readonly connectionId: string;
    readonly model: string;
  } | null;
  readonly isDirty: boolean;
}

function useSpeechDraft(
  administration: SpeechAdministration,
  models: readonly PageAgentModel[],
): SpeechDraft {
  const saved = administration.settings;
  const savedKey = saved.selection
    ? agentModelKey(saved.selection.connectionId, saved.selection.model)
    : "";
  const [modelKey, setModelKey] = useState(savedKey);
  const [maxDurationMs, setMaxDurationMs] = useState<number>(
    saved.maxDurationMs,
  );
  const model = models.find((entry) => entry.id === modelKey);
  // A saved model the choice no longer lists keeps its value until another is chosen.
  const keptSelection = modelKey === savedKey ? saved.selection : null;
  const selection = model?.connectionId
    ? { connectionId: model.connectionId, model: model.model }
    : keptSelection;
  return {
    modelKey,
    setModelKey,
    maxDurationMs,
    setMaxDurationMs,
    selection,
    isDirty: modelKey !== savedKey || maxDurationMs !== saved.maxDurationMs,
  };
}

function SpeechSettingsForm({
  administration,
  isCatalogFailed,
  fetcher,
}: {
  readonly administration: SpeechAdministration;
  readonly isCatalogFailed: boolean;
  readonly fetcher: FetcherWithComponents<AgentActionResult>;
}): React.ReactElement {
  const { t } = useTranslation();
  const models = consumerModels("stt", administration.models);
  const draft = useSpeechDraft(administration, models);
  const test = useSpeechTest(administration.effectiveMaxDurationMs);
  const isPending = fetcher.state !== "idle";
  const canTest =
    administration.status === "ready" && !draft.isDirty && !isPending;
  return (
    <fetcher.Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="save-speech" />
      <input
        type="hidden"
        name="revision"
        value={administration.settings.revision}
      />
      <input
        type="hidden"
        name="modelConnectionId"
        value={draft.selection?.connectionId ?? ""}
      />
      <input type="hidden" name="model" value={draft.selection?.model ?? ""} />
      <input type="hidden" name="maxDurationMs" value={draft.maxDurationMs} />
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 sm:grid-cols-2">
        <ModelPicker
          value={draft.modelKey}
          models={models}
          savedModel={administration.settings.selection?.model ?? ""}
          disabled={isPending}
          label={t("speechSettings.model")}
          placeholder={t("speechSettings.chooseModel")}
          emptyLabel={t("speechSettings.noModels")}
          isCatalogFailed={isCatalogFailed}
          onChange={draft.setModelKey}
        />
        <SpeechDurationField
          value={draft.maxDurationMs}
          modelLimitMs={administration.modelLimits[draft.modelKey] ?? null}
          disabled={isPending}
          onChange={draft.setMaxDurationMs}
        />
      </div>
      <SpeechActions
        administration={administration}
        test={test}
        canTest={canTest}
        isPending={isPending}
      />
      <SpeechUnsuitableNote administration={administration} />
      {draft.isDirty && administration.status === "ready" ? (
        <p className="text-xs text-muted-foreground">
          {t("speechSettings.saveBeforeTest")}
        </p>
      ) : null}
      <SpeechTestResult test={test} />
      <SpeechSaveFeedback result={isPending ? undefined : fetcher.data} />
    </fetcher.Form>
  );
}

// The status on the left; the hint, the test and saving on the right, as in the design.
function SpeechActions(props: {
  readonly administration: SpeechAdministration;
  readonly test: SpeechTest;
  readonly canTest: boolean;
  readonly isPending: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { test } = props;
  function handleTest(): void {
    void test.toggle();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SpeechStatusBadge status={props.administration.status} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-xs text-muted-foreground">
          {t("speechSettings.hint")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!props.canTest || test.isBusy}
          onClick={handleTest}
        >
          {t(`speechSettings.testButton.${test.phase}`)}
        </Button>
        <Button type="submit" size="sm" disabled={props.isPending}>
          {t("settings.agents.save")}
        </Button>
      </div>
    </div>
  );
}

function SpeechSaveFeedback({
  result,
}: {
  readonly result: AgentActionResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (result === undefined) return null;
  if (result.ok)
    return result.intent === "save-speech" ? (
      <p role="status" className="text-sm text-success">
        {t("speechSettings.saved")}
      </p>
    ) : null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t([
        `speechSettings.error.${result.error}`,
        `settings.agents.error.${result.error}`,
        "chat.error.general",
      ])}
    </p>
  );
}

function SpeechDurationField(props: {
  readonly value: number;
  readonly modelLimitMs: number | null;
  readonly disabled: boolean;
  readonly onChange: (duration: number) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = `${useId()}-duration`;
  const label = t("speechSettings.maxDuration");
  const effective = effectiveSpeechDuration(props.value, props.modelLimitMs);
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={MODEL_FIELD_LABEL_CLASS}>
        {label}
      </label>
      <Select
        id={id}
        ariaLabel={label}
        value={String(props.value)}
        disabled={props.disabled}
        options={SPEECH_DURATION_CHOICES.map((choice) => ({
          value: String(choice),
          label: formatSpeechDuration(choice, t),
        }))}
        className={cn(
          MODEL_FIELD_CLASS,
          "font-normal hover:bg-surface-hover [&>span]:min-w-0 [&>span]:truncate [&>svg]:size-4",
        )}
        onValueChange={(choice) => props.onChange(Number(choice))}
      />
      {effective < props.value ? (
        <p role="status" className="mt-1.5 text-xs text-warning">
          {t("speechSettings.modelLimit", {
            limit: formatSpeechDuration(effective, t),
          })}
        </p>
      ) : null}
    </div>
  );
}
