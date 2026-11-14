import { Download, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { VoiceWave } from "../chat-page-voice";
import { decodeAudio, wavePeaks } from "../voice-audio";
import { downloadUrl, formatFileSize } from "./card-types";
import { subtitleOf } from "./content-card";
import { reportMediaFacts, useMediaFacts } from "./media-facts";
import { useRetention } from "./use-retention";
import { formatFixedMediaTime, formatSeconds, useMediaPlayer } from "./use-media-player";
import { useSeen } from "./use-seen";
import { speedLabel } from "./video-controls";

import type { ConversationAttachment } from "@/definition/ConversationContent";

/** Largest audio file whose waveform the browser decodes: 20 MB. A larger one keeps a flat wave. */
const WAVE_SOURCE_MAXIMUM_BYTES = 20 * 1024 * 1024;

/**
 * The fixed columns of a sound row (PAGE-384): Start/Pause · name and infos
 * · waveform (the rest) · time · speed · download. Every row has the same
 * columns, whatever its name, length or state, so rows below each other line
 * up exactly; on a narrow screen the waveform moves into a second line.
 */
export const AUDIO_ROW_COLUMNS =
  "grid-cols-[2.25rem_minmax(0,1fr)_7.5rem_3rem_2rem] sm:grid-cols-[2.25rem_13rem_minmax(0,1fr)_7.5rem_3rem_2rem]";

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
 * A sound of the chat as one row (PAGE-298, PAGE-384): the round
 * Start/Pause in the accent color, name and infos in a fixed width, the
 * waveform with the played part in the accent color (a click seeks), the
 * time always as `0:41 / 1:52`, the speed and "Herunterladen" as an icon in
 * the accent color.
 *
 * @remarks
 * A sound has no "Daneben" and no full screen. It joins the one playback of
 * the page: starting it pauses every other sound and video.
 */
export function AudioPlayer({
  attachment,
  className,
}: AudioPlayerProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const peaks = useAudioPeaks(attachment, useSeen(frame));
  const player = useMediaPlayer<HTMLAudioElement>({
    attachmentId: attachment.id,
    onMetadata: (metadata) =>
      reportMediaFacts(attachment, { durationSeconds: metadata.durationSeconds }),
  });
  const facts = useMediaFacts(attachment);
  const retention = useRetention(attachment.expiresAt);
  const durationSeconds = player.durationSeconds ?? facts.durationSeconds ?? null;
  const PlayIcon = player.isPlaying ? Pause : Play;
  const speed = speedLabel(player.speed, i18n.language);
  const info = subtitleOf([
    t("chatPage.cards.kind.audio"),
    durationSeconds === null ? null : formatSeconds(durationSeconds),
    formatFileSize(attachment.sizeBytes, i18n.language),
    retention,
  ]);
  return (
    <section
      ref={setFrame}
      aria-label={attachment.name}
      className={cn(
        "grid items-center gap-x-3 gap-y-1.5 px-3 py-2.5",
        AUDIO_ROW_COLUMNS,
        className,
      )}
      data-audio-player={attachment.id}
    >
      <button
        aria-label={player.isPlaying ? t("chatPage.cards.pause") : t("chatPage.cards.play")}
        className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={player.toggle}
        type="button"
      >
        <PlayIcon aria-hidden="true" className="size-4" />
      </button>
      <p className="flex min-w-0 flex-col leading-tight" data-audio-name="">
        <span className="truncate text-[13px] font-semibold" title={attachment.name}>
          {attachment.name}
        </span>
        <span className="truncate text-xs text-muted-foreground">{info}</span>
      </p>
      <div className="order-last col-span-full flex min-w-0 sm:order-none sm:col-span-1" data-audio-wave="">
        <VoiceWave
          isOwn={false}
          isRestNeutral
          label={t("chatPage.cards.seek")}
          onSeek={player.seek}
          peaks={peaks}
          share={player.share}
        />
      </div>
      <span className="text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums" data-audio-time="">
        {formatFixedMediaTime(player.positionSeconds, durationSeconds)}
      </span>
      <button
        aria-label={t("chatPage.cards.speed", { speed })}
        className="h-7 cursor-pointer rounded-md text-center text-xs font-medium text-muted-foreground tabular-nums hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={player.nextSpeed}
        title={t("chatPage.cards.speed", { speed })}
        type="button"
      >
        {speed}
      </button>
      <a
        className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        download=""
        href={downloadUrl(attachment)}
        title={t("chatPage.cards.download")}
      >
        <Download aria-hidden="true" className="size-4" />
        <span className="sr-only">{t("chatPage.cards.download")}</span>
      </a>
      <audio
        ref={player.media}
        className="hidden"
        preload="metadata"
        src={attachment.url}
        {...player.events}
      />
    </section>
  );
}

/**
 * The card of an audio file of a message (PAGE-298, PAGE-384): one row of
 * the fixed sound grid in a frame of the fixed width every sound row has.
 */
export function AudioCard({
  attachment,
}: {
  readonly attachment: ConversationAttachment;
}): React.ReactElement {
  return (
    <div
      className="w-full max-w-full overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-xs sm:w-[42rem]"
      data-content-card={`att:${attachment.id}`}
      data-audio-row=""
    >
      <AudioPlayer attachment={attachment} />
    </div>
  );
}
