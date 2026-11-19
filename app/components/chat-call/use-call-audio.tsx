import { createContext, useContext, useEffect, useRef, useState } from "react";

import {
  MicrophoneError,
  openMicrophone,
  releaseStream,
} from "./audio-devices";
import { readAudioPreferences } from "./audio-preferences";
import { CallAudioSession } from "./call-audio-session";
import { useChatCalls } from "./use-chat-calls";

import type { CallAudioOptions, CallAudioState } from "./call-audio-session";
import type { ChatCallView } from "@/definition/ChatCall";

/** How long a microphone opened for a call waits for the call to show up, in milliseconds. */
const WAIT_FOR_CALL_MILLISECONDS = 60_000;

/**
 * The audio of the running call and what the bar and the buttons do with it.
 */
export interface CallAudioControl {
  /**
   * Opens the microphone for a call the person is about to start or accept;
   * this is the moment the browser asks for permission. A refusal does not
   * stop the call: it runs without the microphone and the bar says so.
   * @remarks
   * Call it from the click that starts or accepts the call, before the server
   * learns of it.
   */
  readonly prepare: (participantId: string) => Promise<void>;
  /** Releases the microphone opened for a person again when the call could not start. */
  readonly discard: (participantId: string) => void;
  /** The audio of the running call; `null` without one. */
  readonly state: CallAudioState | null;
  /** Mutes or unmutes the microphone of the running call. */
  readonly toggleMute: () => void;
}

const NO_AUDIO: CallAudioControl = {
  prepare: () => Promise.resolve(),
  discard: () => undefined,
  state: null,
  toggleMute: () => undefined,
};

/** Shares the audio of the running call with the bar; outside the provider there is none. */
export const CallAudioContext = createContext<CallAudioControl>(NO_AUDIO);

/** Reads the audio of the running call. */
export function useCallAudio(): CallAudioControl {
  return useContext(CallAudioContext);
}

/** The microphone one call uses, held from the click that starts or accepts it until the call is over. */
interface HeldMicrophone {
  readonly participantId: string;
  readonly microphone: CallAudioOptions["microphone"];
  /** Whether the call has shown up in the list; after that its end releases the microphone. */
  hasBeenSeen: boolean;
  readonly timer: ReturnType<typeof setTimeout>;
}

function releaseHeld(held: React.RefObject<HeldMicrophone | null>): void {
  const current = held.current;
  held.current = null;
  if (current === null) return;
  clearTimeout(current.timer);
  if ("stream" in current.microphone) releaseStream(current.microphone.stream);
}

function releaseWhenCallIsOver(
  held: React.RefObject<HeldMicrophone | null>,
  calls: readonly ChatCallView[],
): void {
  const current = held.current;
  if (current === null) return;
  const isPresent = calls.some(
    (call) => call.participant.id === current.participantId,
  );
  if (isPresent) current.hasBeenSeen = true;
  else if (current.hasBeenSeen) releaseHeld(held);
}

async function openForCall(): Promise<CallAudioOptions["microphone"]> {
  try {
    const stream = await openMicrophone(
      readAudioPreferences().microphone?.id ?? "",
    );
    return { stream };
  } catch (error: unknown) {
    return {
      failure: error instanceof MicrophoneError ? error.failure : "unavailable",
    };
  }
}

/**
 * Carries the audio of the running call for the whole signed-in page, so it
 * goes on while the person opens other chats.
 * @remarks
 * The microphone opens when the person starts or accepts the call and
 * is released when the call is over, however it ends. The devices chosen at
 * that moment are the ones of the call; a new choice applies to the next
 * call. It must sit below the provider of the chat calls.
 */
export function CallAudioProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { calls, refresh } = useChatCalls();
  const [state, setState] = useState<CallAudioState | null>(null);
  const held = useRef<HeldMicrophone | null>(null);
  const session = useRef<CallAudioSession | null>(null);
  const isMounted = useRef(true);
  const active = calls.find((call) => call.status === "active");
  const activeId = active?.id ?? null;
  const participantId = active?.participant.id ?? null;
  const isCaller = active?.isOutgoing ?? false;

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      releaseHeld(held);
    };
  }, []);

  useEffect(() => {
    releaseWhenCallIsOver(held, calls);
  }, [calls]);

  useEffect(() => {
    if (activeId === null || participantId === null) return undefined;
    const microphone: CallAudioOptions["microphone"] =
      held.current?.participantId === participantId
        ? held.current.microphone
        : { failure: "unavailable" };
    const instance = new CallAudioSession({
      callId: activeId,
      isCaller,
      microphone,
      speakerId: readAudioPreferences().speaker?.id ?? "",
      onChange: setState,
      onEnded: refresh,
    });
    session.current = instance;
    instance.start();
    return () => {
      instance.close();
      session.current = null;
      setState(null);
    };
  }, [activeId, participantId, isCaller, refresh]);

  async function prepare(forParticipantId: string): Promise<void> {
    // A running call, or one that rings, keeps the microphone it has.
    if (session.current !== null || held.current !== null) return;
    const microphone = await openForCall();
    const timer = setTimeout(() => {
      if (held.current?.hasBeenSeen === false) releaseHeld(held);
    }, WAIT_FOR_CALL_MILLISECONDS);
    const opened: HeldMicrophone = {
      participantId: forParticipantId,
      microphone,
      hasBeenSeen: false,
      timer,
    };
    held.current = opened;
    // The page closed while the browser asked for permission.
    if (!isMounted.current) releaseHeld(held);
  }

  function discard(forParticipantId: string): void {
    if (held.current?.participantId === forParticipantId) releaseHeld(held);
  }

  function toggleMute(): void {
    session.current?.setMuted(state?.microphone !== "muted");
  }

  return (
    <CallAudioContext value={{ prepare, discard, state, toggleMute }}>
      {children}
    </CallAudioContext>
  );
}
