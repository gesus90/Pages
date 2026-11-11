import { LoaderCircle, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { VoiceCard } from "./voice-card";

import type { VoiceSample } from "./use-voice-sample";

/** Heights of the decorative wave, in percent of the player's height. */
const WAVE_BARS = [
  30, 55, 40, 75, 50, 90, 60, 35, 70, 45, 85, 55, 30, 65, 95, 50, 40, 70, 35,
  60, 80, 45, 30, 55,
];

interface VoiceSampleCardProps {
  readonly agentName: string;
  /** The fixed sentence the server speaks, in the page's language. */
  readonly sentence: string;
  /** The voice the sample speaks with; `null` for the model's first voice. */
  readonly voiceId: string | null;
  readonly speedTenths: number;
  readonly sample: VoiceSample;
  readonly canHear: boolean;
  /** Why no sample can be heard, shown instead of the hint; `null` when one can. */
  readonly blockedReason: string | null;
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "0:00";
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function SampleButtonIcon({
  sample,
  isOwn,
}: {
  readonly sample: VoiceSample;
  readonly isOwn: boolean;
}): React.ReactElement {
  if (isOwn && sample.isLoading)
    return <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />;
  if (isOwn && sample.isPlaying)
    return <Pause className="size-4" aria-hidden="true" />;
  return <Play className="size-4" aria-hidden="true" />;
}

/** The player of the sample: a play button, the wave and the length. */
function SamplePlayer(props: VoiceSampleCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { sample } = props;
  const isOwn = sample.activeVoice === props.voiceId;
  const played = isOwn ? sample.progress : 0;
  function handleToggle(): void {
    sample.toggle({ voiceId: props.voiceId, speedTenths: props.speedTenths });
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <button
        type="button"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!props.canHear}
        aria-label={t("agentVoice.sample.play")}
        onClick={handleToggle}
      >
        <SampleButtonIcon sample={sample} isOwn={isOwn} />
      </button>
      <div
        className="flex h-6 min-w-0 flex-1 items-center gap-0.5"
        aria-hidden="true"
      >
        {WAVE_BARS.map((height, index) => (
          <span
            // The bars are a fixed decoration; their position is their identity.
            key={index}
            className={cn(
              "w-1 rounded-full",
              index / WAVE_BARS.length < played
                ? "bg-primary"
                : "bg-muted-foreground/40",
            )}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {formatSeconds(isOwn ? sample.durationSeconds : null)}
      </span>
    </div>
  );
}

/** The card "Probe": the fixed sentence and a player that speaks it (PAGE-300). */
export function VoiceSampleCard(
  props: VoiceSampleCardProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { sample } = props;
  return (
    <VoiceCard
      icon={<Play className="size-4" />}
      title={t("agentVoice.sample.title")}
      description={t("agentVoice.sample.description", {
        name: props.agentName,
      })}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("agentVoice.sample.sentenceLabel")}
        </span>
        <p className="rounded-xl border border-border bg-surface px-3 py-2 text-sm">
          {props.sentence}
        </p>
      </div>
      <SamplePlayer {...props} />
      {sample.error ? (
        <p role="alert" className="text-xs text-destructive">
          {t([`agentVoice.error.${sample.error}`, "agentVoice.error.request"])}
        </p>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {props.blockedReason ?? t("agentVoice.sample.hint")}
      </p>
    </VoiceCard>
  );
}
