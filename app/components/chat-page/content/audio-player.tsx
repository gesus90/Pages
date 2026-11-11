import { Download, Music, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { VoiceWave } from "../chat-page-voice";
import { decodeAudio, wavePeaks } from "../voice-audio";
import { downloadUrl, formatFileSize } from "./card-types";
import { CardAction, ContentCard } from "./content-card";
import { formatMediaTime, useMediaPlayer } from "./use-media-player";
import { useSeen } from "./use-seen";

import type { ConversationAttachment } from "@/definition/ConversationContent";

/** Largest audio file whose waveform the browser decodes: 20 MB. A larger one keeps a flat wave. */
const WAVE_SOURCE_MAXIMUM_BYTES = 20 * 1024 * 1024;

/**
 * The waveform of an audio file, read once in the browser when it is wanted;
 * `null` (a flat wave) until then, for a large file or one that cannot be read.
 */
function useAudioPeaks(
  attachment: ConversationAttachment,
  isWanted: boolean,
): readonly number[] | null {
  const [peaks, setPeaks] = useState<readonly number[] | null>(null);
  const { url } = attachment;
  const isDecodable =
    isWanted && attachment.sizeBytes <= WAVE_SOURCE_MAXIMUM_BYTES;
  useEffect(() => {
    if (!isDecodable) return undefined;
    const controller = new AbortController();
    async function read(): Promise<void> {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return;
      const audio = await decodeAudio(await response.arrayBuffer());
      if (!controller.signal.aborted)
        setPeaks(wavePeaks(audio.getChannelData(0)));
    }
    void read().catch(() => undefined);
    return () => controller.abort();
  }, [url, isDecodable]);
  return peaks;
}

interface AudioPlayerProps {
  readonly attachment: ConversationAttachment;
  readonly className?: string;
}

/**
 * The audio player of the chat (PAGE-298): Start/Pause, the waveform of
 * voice messages with the played part, seeking by a click, and the position
 * and length.
 */
export function AudioPlayer({
  attachment,
  className,
}: AudioPlayerProps): React.ReactElement {
  const { t } = useTranslation();
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const peaks = useAudioPeaks(attachment, useSeen(frame));
  const player = useMediaPlayer<HTMLAudioElement>();
  const PlayIcon = player.isPlaying ? Pause : Play;
  return (
    <div
      ref={setFrame}
      className={cn("flex items-center gap-2 px-3 py-2.5", className)}
      data-audio-player={attachment.id}
    >
      <button
        aria-label={
          player.isPlaying
            ? t("chatPage.cards.pause")
            : t("chatPage.cards.play")
        }
        className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={player.toggle}
        type="button"
      >
        <PlayIcon aria-hidden="true" className="size-4" />
      </button>
      <VoiceWave
        isOwn={false}
        label={t("chatPage.cards.seek")}
        onSeek={player.seek}
        peaks={peaks}
        share={player.share}
      />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {formatMediaTime(player.positionSeconds, player.durationSeconds)}
      </span>
      <audio
        ref={player.media}
        className="hidden"
        preload="metadata"
        src={attachment.url}
        {...player.events}
      />
    </div>
  );
}

/** The card of an audio file of a message (PAGE-298): the player and Laden. */
export function AudioCard({
  attachment,
}: {
  readonly attachment: ConversationAttachment;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  return (
    <ContentCard
      actions={
        <CardAction
          href={downloadUrl(attachment)}
          icon={Download}
          label={t("chatPage.cards.download")}
        />
      }
      cardKey={`att:${attachment.id}`}
      className="max-w-md"
      defaultState="expanded"
      icon={Music}
      kindLabel={t("chatPage.cards.kind.audio")}
      meta={formatFileSize(attachment.sizeBytes, i18n.language)}
      name={attachment.name}
    >
      <AudioPlayer attachment={attachment} />
    </ContentCard>
  );
}
