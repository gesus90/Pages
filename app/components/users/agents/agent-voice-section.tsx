import { useTranslation } from "react-i18next";

import { effectiveAgentVoice } from "@/definition/SpeechSynthesis";

import { useVoiceSample } from "./agent-voice-section/use-voice-sample";
import { VoiceChoiceCard } from "./agent-voice-section/voice-choice-card";
import { VoiceSampleCard } from "./agent-voice-section/voice-sample-card";

import type { AgentVoiceOptions } from "@/definition/SpeechSynthesis";

interface AgentVoiceSectionProps {
  /** The stored agent; `null` for an agent not yet created, which has no sample yet. */
  readonly agentId: string | null;
  /** The name the sample names: the stored one, or the draft's for a new agent. */
  readonly agentName: string;
  readonly options: AgentVoiceOptions;
  readonly voiceId: string;
  readonly speedTenths: number;
  readonly isDisabled: boolean;
  readonly onVoice: (voiceId: string) => void;
  readonly onSpeed: (speedTenths: number) => void;
}

/** Why no sample can be heard, or `null` when one can. */
function useBlockedReason(
  options: AgentVoiceOptions,
  agentId: string | null,
): string | null {
  const { t } = useTranslation();
  if (options.model === null) return t(`agentVoice.blocked.${options.status}`);
  return agentId === null ? t("agentVoice.blocked.notCreated") : null;
}

/**
 * The tab "Stimme" of the agent panel (PAGE-300): the voice of the
 * instance's speech output model and the speed, with a sample to hear.
 *
 * @remarks
 * Voice and speed are fields of the agent's draft and are saved with the
 * panel. Without a chosen voice the model's first voice applies and no tile
 * is marked; a saved voice the model lacks stays saved and is named. Without
 * a speech output model the tab is disabled and points to the settings.
 */
export function AgentVoiceSection(
  props: AgentVoiceSectionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const sample = useVoiceSample(props.agentId);
  const { model } = props.options;
  const saved = props.voiceId.trim() === "" ? null : props.voiceId.trim();
  const effective = effectiveAgentVoice(model?.voices ?? null, saved);
  const blockedReason = useBlockedReason(props.options, props.agentId);
  const isDisabled = props.isDisabled || model === null;
  const canHear = blockedReason === null && !props.isDisabled;
  const name = props.agentName.trim() || t("agentVoice.unnamed");
  return (
    <div className="@container">
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <VoiceChoiceCard
          agentName={name}
          model={model}
          missingModelReason={t(`agentVoice.blocked.${props.options.status}`)}
          voiceId={props.voiceId}
          effective={effective}
          speedTenths={props.speedTenths}
          sample={sample}
          canHear={canHear}
          isDisabled={isDisabled}
          onVoice={props.onVoice}
          onSpeed={props.onSpeed}
        />
        <VoiceSampleCard
          agentName={name}
          sentence={t("agentVoice.sample.sentence", { name })}
          voiceId={effective.voiceId}
          speedTenths={props.speedTenths}
          sample={sample}
          canHear={canHear}
          blockedReason={model === null ? null : blockedReason}
        />
      </div>
    </div>
  );
}
