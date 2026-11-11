import { Pause, Play, Search, Volume2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";
import { AGENT_VOICE_ID_MAXIMUM } from "@/definition/SpeechSynthesis";

import { VoiceCard } from "./voice-card";
import { VoiceSpeedField } from "./voice-speed-field";

import type {
  AgentVoiceModel,
  EffectiveAgentVoice,
} from "@/definition/SpeechSynthesis";
import type { VoiceSample } from "./use-voice-sample";

interface VoiceChoiceCardProps {
  readonly agentName: string;
  /** The instance's model; `null` while none is chosen, which disables the card. */
  readonly model: AgentVoiceModel | null;
  /** Why there is no model, shown instead of the voices while `model` is `null`. */
  readonly missingModelReason: string;
  /** The voice ID of the draft; empty while the agent uses the first voice. */
  readonly voiceId: string;
  readonly effective: EffectiveAgentVoice;
  readonly speedTenths: number;
  readonly sample: VoiceSample;
  /** Whether a sample can be heard: the agent exists and a model is chosen. */
  readonly canHear: boolean;
  readonly isDisabled: boolean;
  readonly onVoice: (voiceId: string) => void;
  readonly onSpeed: (speedTenths: number) => void;
}

interface VoiceTileProps {
  readonly voice: string;
  readonly isChosen: boolean;
  readonly isPlaying: boolean;
  readonly canHear: boolean;
  readonly isDisabled: boolean;
  readonly onChoose: () => void;
  readonly onHear: () => void;
}

/** One voice: a play button to hear it and the name to choose it. */
function VoiceTile(props: VoiceTileProps): React.ReactElement {
  const { t } = useTranslation();
  const Icon = props.isPlaying ? Pause : Play;
  return (
    <li
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl border bg-surface px-3 py-2.5",
        props.isChosen
          ? "border-primary bg-primary-subtle"
          : "border-border hover:bg-surface-hover",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60",
          props.isChosen
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
        disabled={!props.canHear}
        aria-label={t("agentVoice.hear", { voice: props.voice })}
        onClick={props.onHear}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm font-semibold disabled:cursor-not-allowed"
        disabled={props.isDisabled}
        aria-pressed={props.isChosen}
        onClick={props.onChoose}
      >
        <span className="truncate">{props.voice}</span>
        {props.isChosen ? (
          <span className="shrink-0 text-xs font-semibold text-primary">
            {t("agentVoice.chosen")}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** The voices of the model as tiles in two columns, with a search above them. */
function VoiceTiles({
  voices,
  props,
}: {
  readonly voices: readonly string[];
  readonly props: VoiceChoiceCardProps;
}): React.ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const shown = voices.filter((voice) =>
    voice.toLocaleLowerCase().includes(needle),
  );
  const { sample } = props;
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          className="pl-9 xl:pl-9"
          value={query}
          placeholder={t("agentVoice.search")}
          aria-label={t("agentVoice.search")}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("agentVoice.noMatch")}
        </p>
      ) : (
        <ul className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto @sm:grid-cols-2">
          {shown.map((voice) => (
            <VoiceTile
              key={voice}
              voice={voice}
              isChosen={props.voiceId === voice}
              isPlaying={sample.isPlaying && sample.activeVoice === voice}
              canHear={props.canHear}
              isDisabled={props.isDisabled}
              onChoose={() => props.onVoice(voice)}
              onHear={() =>
                sample.toggle({
                  voiceId: voice,
                  speedTenths: props.speedTenths,
                })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The field for a model whose catalog lists no voices. */
function VoiceIdField(props: VoiceChoiceCardProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {t("agentVoice.voiceId")}
      </label>
      <Input
        id={id}
        value={props.voiceId}
        maxLength={AGENT_VOICE_ID_MAXIMUM}
        disabled={props.isDisabled}
        placeholder={t("agentVoice.voiceIdPlaceholder")}
        onChange={(event) => props.onVoice(event.currentTarget.value)}
      />
      <p className="text-xs text-muted-foreground">
        {t("agentVoice.voiceIdHint")}
      </p>
    </div>
  );
}

/** The tiles, the voice ID field without a list, or why there is no model. */
function VoiceChoices(props: VoiceChoiceCardProps): React.ReactElement {
  const { model } = props;
  if (model === null)
    return (
      <p
        role="status"
        className="rounded-xl bg-warning-subtle px-3 py-2 text-sm text-warning"
      >
        {props.missingModelReason}
      </p>
    );
  return model.voices ? (
    <VoiceTiles voices={model.voices} props={props} />
  ) : (
    <VoiceIdField {...props} />
  );
}

function VoiceListLabel({
  model,
}: {
  readonly model: AgentVoiceModel | null;
}): React.ReactElement {
  const { t } = useTranslation();
  if (model?.voices)
    return (
      <p className="text-xs font-medium text-muted-foreground">
        {t("agentVoice.listTitle", {
          count: model.voices.length,
          model: model.name,
        })}
      </p>
    );
  return (
    <p className="text-xs font-medium text-muted-foreground">
      {model
        ? t("agentVoice.listTitleNoVoices", { model: model.name })
        : t("agentVoice.title")}
    </p>
  );
}

/**
 * The card "Stimme": the voices of the instance's model, or a voice ID
 * field without a list, and the speed (PAGE-300).
 */
export function VoiceChoiceCard(
  props: VoiceChoiceCardProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { model, effective } = props;
  return (
    <VoiceCard
      icon={<Volume2 className="size-4" />}
      title={t("agentVoice.title")}
      description={t("agentVoice.description", { name: props.agentName })}
    >
      <VoiceListLabel model={model} />
      <VoiceChoices {...props} />
      {effective.missingVoiceId !== null ? (
        <p role="status" className="text-xs text-warning">
          {t("agentVoice.missingVoice", { voice: effective.missingVoiceId })}
        </p>
      ) : null}
      <VoiceSpeedField
        value={props.speedTenths}
        isDisabled={props.isDisabled}
        onChange={props.onSpeed}
      />
    </VoiceCard>
  );
}
