import { useState } from "react";
import { useRevalidator } from "react-router";

import { CONVERSATION_VOICE_MAXIMUM_BYTES } from "@/definition/Conversation";

import { decodeAudio, VOICE_FILE_TYPES } from "./voice-audio";

import type { VirtualChatSelection } from "@/definition/VirtualChat";
import type { VoiceRecording } from "./use-voice-recorder";

/** Why a voice message was not sent, as the page explains it. */
export type VoiceFailure =
  | "too_large"
  | "too_long"
  | "unsupported_format"
  | "invalid"
  | "not_found"
  | "forbidden"
  | "microphone"
  | "general";

/** The sending of voice messages of the opened conversation. */
export interface VoiceSending {
  readonly isSending: boolean;
  readonly failure: VoiceFailure | null;
  /** Sends a recording made in the page. */
  sendRecording(recording: VoiceRecording): void;
  /** Checks and sends a WAV or MP3 file the person picked. */
  sendFile(file: File): void;
  /** Shows why the microphone could not record. */
  reportMicrophone(): void;
}

const FAILURES: readonly VoiceFailure[] = [
  "too_large",
  "too_long",
  "unsupported_format",
  "invalid",
  "not_found",
  "forbidden",
];

function readFailure(body: unknown): VoiceFailure {
  if (typeof body !== "object" || body === null || !("error" in body))
    return "general";
  return FAILURES.find((failure) => failure === body.error) ?? "general";
}

async function postVoice(
  selection: VirtualChatSelection,
  recording: { readonly file: Blob; readonly durationMs: number },
): Promise<VoiceFailure | null> {
  const query = new URLSearchParams({
    kind: selection.kind,
    id: selection.id,
    clientMessageId: crypto.randomUUID(),
    durationMs: String(Math.max(1, Math.round(recording.durationMs))),
  });
  const response = await fetch(`/chat-page-api/voice?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": recording.file.type },
    body: recording.file,
  });
  if (response.ok) return null;
  return readFailure(await response.json().catch(() => null));
}

/**
 * Sends voice messages into the opened conversation of a person or a group
 * (PAGE-277).
 *
 * @param selection - The opened conversation.
 * @param maximumMs - The longest recording of Pages.
 * @returns The sending and its last refusal.
 *
 * @remarks
 * The page refuses what is obviously too large, too long or of another
 * format before sending, with the same reasons the server gives; the server
 * checks everything again. A sent message shows once the page reads it back.
 */
export function useVoiceSending(
  selection: VirtualChatSelection | null,
  maximumMs: number,
): VoiceSending {
  const [isSending, setSending] = useState(false);
  const [failure, setFailure] = useState<VoiceFailure | null>(null);
  const revalidator = useRevalidator();

  async function send(recording: {
    readonly file: Blob;
    readonly durationMs: number;
  }): Promise<void> {
    if (!selection) return;
    setSending(true);
    setFailure(null);
    try {
      setFailure(await postVoice(selection, recording));
      await revalidator.revalidate();
    } catch (error: unknown) {
      console.warn("The voice message could not be sent", error);
      setFailure("general");
    } finally {
      setSending(false);
    }
  }

  async function checkFile(file: File): Promise<void> {
    const type = VOICE_FILE_TYPES[file.type];
    if (type === undefined) return setFailure("unsupported_format");
    if (file.size > CONVERSATION_VOICE_MAXIMUM_BYTES)
      return setFailure("too_large");
    const audio = await decodeAudio(await file.arrayBuffer()).catch(() => null);
    if (!audio) return setFailure("unsupported_format");
    const durationMs = Math.round(audio.duration * 1000);
    if (durationMs > maximumMs) return setFailure("too_long");
    await send({ file: new Blob([file], { type }), durationMs });
  }

  return {
    isSending,
    failure,
    sendRecording: (recording) => void send(recording),
    sendFile: (file) => void checkFile(file),
    reportMicrophone: () => setFailure("microphone"),
  };
}
