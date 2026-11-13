import { Volume2 } from "lucide-react";
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
import { SPEECH_SYNTHESIS_DURATION_CHOICES } from "@/definition/SpeechSynthesis";

import { formatSpeechDuration } from "./speech-settings/speech-status";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { PageAgentModel } from "@/definition/PageAgent";
import type {
  SpeechSynthesisAdministration,
  SpeechSynthesisStatus,
} from "@/definition/SpeechSynthesis";
import type { FetcherWithComponents } from "react-router";

const STATUS_CLASSES: Readonly<Record<SpeechSynthesisStatus, string>> = {
  ready: "bg-success-subtle text-success",
  noModel: "bg-muted text-muted-foreground",
  modelUnavailable: "bg-warning-subtle text-warning",
};

const INTENT = "save-speech-synthesis";

interface SpeechSynthesisCardProps {
  readonly administration: SpeechSynthesisAdministration;
  /** Whether the last server refresh of a catalog failed; the model choice then warns. */
  readonly isCatalogFailed?: boolean;
}

interface SpeechSynthesisDraft {
  readonly modelKey: string;
  readonly setModelKey: (key: string) => void;
  readonly maxDurationMs: number;
  readonly setMaxDurationMs: (duration: number) => void;
  readonly selection: {
    readonly connectionId: string;
    readonly model: string;
  } | null;
}

function useSpeechSynthesisDraft(
  administration: SpeechSynthesisAdministration,
  models: readonly PageAgentModel[],
): SpeechSynthesisDraft {
  const saved = administration.settings;
  const savedKey = saved.selection
    ? agentModelKey(saved.selection.connectionId, saved.selection.model)
    : "";
  const [modelKey, setModelKey] = useState(savedKey);
  const [maxDurationMs, setMaxDurationMs] = useState<number>(
    saved.maxDurationMs,
  );
  const model = models.find((entry) => entry.id === modelKey);
  // A saved model the catalog no longer lists keeps its value until another is chosen.
  const keptSelection = modelKey === savedKey ? saved.selection : null;
  return {
    modelKey,
    setModelKey,
    maxDurationMs,
    setMaxDurationMs,
    selection: model?.connectionId
      ? { connectionId: model.connectionId, model: model.model }
      : keptSelection,
  };
}

/** Whether the saved speech output can run: ready, no model, or a model no longer offered. */
function SpeechSynthesisStatusBadge({
  status,
}: {
  readonly status: SpeechSynthesisStatus;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      role="status"
      className={cn(
        "rounded-md px-2 py-1 text-xs font-semibold",
        STATUS_CLASSES[status],
      )}
    >
      {t(`speechSynthesis.status.${status}`)}
    </span>
  );
}

function SpeechSynthesisDurationField(props: {
  readonly value: number;
  readonly disabled: boolean;
  readonly onChange: (duration: number) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = `${useId()}-duration`;
  const label = t("speechSynthesis.maxDuration");
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
        options={SPEECH_SYNTHESIS_DURATION_CHOICES.map((choice) => ({
          value: String(choice),
          label: formatSpeechDuration(choice, t),
        }))}
        className={cn(
          MODEL_FIELD_CLASS,
          "font-normal hover:bg-surface-hover [&>span]:min-w-0 [&>span]:truncate [&>svg]:size-4",
        )}
        onValueChange={(choice) => props.onChange(Number(choice))}
      />
    </div>
  );
}

function SpeechSynthesisFeedback({
  result,
}: {
  readonly result: AgentActionResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (result === undefined) return null;
  if (result.ok)
    return result.intent === INTENT ? (
      <p role="status" className="text-sm text-success">
        {t("speechSynthesis.saved")}
      </p>
    ) : null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t([
        `speechSynthesis.error.${result.error}`,
        `settings.agents.error.${result.error}`,
        "chat.error.general",
      ])}
    </p>
  );
}

function SpeechSynthesisForm({
  administration,
  isCatalogFailed,
  fetcher,
}: {
  readonly administration: SpeechSynthesisAdministration;
  readonly isCatalogFailed: boolean;
  readonly fetcher: FetcherWithComponents<AgentActionResult>;
}): React.ReactElement {
  const { t } = useTranslation();
  const models = consumerModels("tts", administration.models);
  const draft = useSpeechSynthesisDraft(administration, models);
  const isPending = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value={INTENT} />
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
          consumer="tts"
          value={draft.modelKey}
          models={models}
          savedModel={administration.settings.selection?.model ?? ""}
          disabled={isPending}
          label={t("speechSynthesis.model")}
          placeholder={t("speechSynthesis.chooseModel")}
          emptyLabel={t("speechSynthesis.noModels")}
          isCatalogFailed={isCatalogFailed}
          onChange={draft.setModelKey}
        />
        <SpeechSynthesisDurationField
          value={draft.maxDurationMs}
          disabled={isPending}
          onChange={draft.setMaxDurationMs}
        />
      </div>
      {models.length === 0 ? (
        <p className="text-xs text-warning">{t("speechSynthesis.noModels")}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {t("settings.agents.save")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("speechSynthesis.hint")}
      </p>
      <SpeechSynthesisFeedback result={isPending ? undefined : fetcher.data} />
    </fetcher.Form>
  );
}

/**
 * The speech output (TTS) of the instance (PAGE-300), beside the speech
 * recognition.
 *
 * @remarks
 * The model choice is the shared one of Pages, fed only with the speech
 * output models of the instance by the central rule `tts` of
 * `modelConsumerRefusal`. No model is chosen in advance. The voice and the
 * speed are chosen per agent in the user administration, not here.
 */
export function SpeechSynthesisCard({
  administration,
  isCatalogFailed,
}: SpeechSynthesisCardProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>({ key: INTENT });
  return (
    <SettingsCard
      icon={<Volume2 className="size-4" />}
      title={t("speechSynthesis.title")}
      description={t("speechSynthesis.description")}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {administration.isSimulation ? (
            <span className="rounded-md bg-warning-subtle px-2 py-1 text-xs font-semibold text-warning">
              {t("speechSettings.simulation")}
            </span>
          ) : null}
          <SpeechSynthesisStatusBadge status={administration.status} />
        </div>
      }
    >
      <SpeechSynthesisForm
        key={administration.settings.revision}
        administration={administration}
        isCatalogFailed={isCatalogFailed === true}
        fetcher={fetcher}
      />
    </SettingsCard>
  );
}
