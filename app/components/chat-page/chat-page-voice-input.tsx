import { useEffect, useRef } from "react";
import { FileAudio, Mic, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { useVoiceRecorder } from "./use-voice-recorder";
import { formatVoiceDuration } from "./voice-audio";

import type { VoiceSending } from "./use-voice-sending";

const ICON_BUTTON =
  "size-9 min-h-9 shrink-0 rounded-[10px] p-0 xl:min-h-9 xl:p-0";

interface ChatPageVoiceInputProps {
  readonly sending: VoiceSending;
  /** The longest recording of Pages, in milliseconds. */
  readonly maximumMs: number;
  /** Receives what starts a recording, for the "+" menu of the composer. */
  readonly recordRef?: React.RefObject<(() => void) | null>;
}

/**
 * Recording and picking a voice message in the composer (PAGE-277): the
 * microphone records until "Senden" or the longest recording, "Abbrechen"
 * drops it, and a WAV or MP3 file can be chosen instead.
 */
export function ChatPageVoiceInput({
  sending,
  maximumMs,
  recordRef,
}: ChatPageVoiceInputProps): React.ReactElement {
  const { t } = useTranslation();
  const picker = useRef<HTMLInputElement | null>(null);
  const recorder = useVoiceRecorder(maximumMs, sending.sendRecording);

  async function handleRecord(): Promise<void> {
    if (sending.isSending) return;
    if (!(await recorder.start())) sending.reportMicrophone();
  }

  useEffect(() => {
    if (recordRef) recordRef.current = () => void handleRecord();
  });

  function handlePick(event: React.ChangeEvent<HTMLInputElement>): void {
    const [file] = event.currentTarget.files ?? [];
    event.currentTarget.value = "";
    if (file) sending.sendFile(file);
  }

  if (recorder.isRecording)
    return (
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2.5 animate-pulse rounded-full bg-destructive"
        />
        <span className="text-sm tabular-nums" role="status">
          {t("chatPage.voice.recording", {
            elapsed: formatVoiceDuration(recorder.elapsedMs),
            maximum: formatVoiceDuration(maximumMs),
          })}
        </span>
        <Button
          aria-label={t("chatPage.voice.cancel")}
          className={ICON_BUTTON}
          onClick={recorder.cancel}
          title={t("chatPage.voice.cancel")}
          variant="outline"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
        <Button className="h-9 gap-1.5 px-3 text-sm" onClick={recorder.stop}>
          <Send aria-hidden="true" className="size-4" />
          {t("chatPage.voice.sendRecording")}
        </Button>
      </div>
    );
  return (
    <div className="flex items-center gap-2">
      <Button
        aria-label={t("chatPage.voice.record")}
        className={ICON_BUTTON}
        disabled={sending.isSending}
        onClick={() => void handleRecord()}
        title={t("chatPage.voice.record")}
        variant="outline"
      >
        <Mic aria-hidden="true" className="size-4" />
      </Button>
      <Button
        aria-label={t("chatPage.voice.pickFile")}
        className={ICON_BUTTON}
        disabled={sending.isSending}
        onClick={() => picker.current?.click()}
        title={t("chatPage.voice.pickFile")}
        variant="outline"
      >
        <FileAudio aria-hidden="true" className="size-4" />
      </Button>
      <input
        ref={picker}
        accept="audio/*,.wav,.mp3"
        className="hidden"
        data-testid="voice-file"
        onChange={handlePick}
        type="file"
      />
      {sending.isSending ? (
        <span className="text-sm text-muted-foreground" role="status">
          {t("chatPage.voice.sending")}
        </span>
      ) : null}
    </div>
  );
}
