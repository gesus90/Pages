import { useState } from "react";

import { useAudioSettings } from "./audio-settings-context";
import { useCallAudio } from "./use-call-audio";
import { useChatCalls } from "./use-chat-calls";

import type { ChatCallView } from "@/definition/ChatCall";
import type { VirtualParticipant } from "@/definition/VirtualChat";
import type { ChatCallBarAudio } from "./chat-call-audio-bar";
import type { ChatCallPhase } from "./chat-call-bar";

/** The call of the opened direct chat: what the bar shows and what the buttons do. */
export interface DirectCall {
  /** What the bar shows; `null` when the chat has no call to show. */
  readonly phase: ChatCallPhase | null;
  /** Whether a call runs or rings in this chat, so "Anruf starten" starts nothing. */
  readonly isRunning: boolean;
  readonly start: () => void;
  /** "Abbrechen" while waiting, "Auflegen" once the call runs. */
  readonly end: () => void;
  /** The audio of a call with a person; missing for the simulated call with an agent. */
  readonly audio?: ChatCallBarAudio;
}

function humanPhase(call: ChatCallView | undefined): ChatCallPhase | null {
  if (call === undefined) return null;
  if (call.status === "active") return "active";
  // The recipient of a ringing call answers in the notice, not in the chat.
  return call.isOutgoing ? "waiting" : null;
}

/**
 * The call of the direct chat with the opened participant.
 * @remarks
 * With an agent the call starts and ends in the page at once, simulated: no
 * server, no model, no voice, no microphone. With a person the server keeps
 * the call, so both sides see it, and the microphone opens when the person
 * starts the call; the running call carries voice in both directions.
 * Without a participant, as in a group, no call exists.
 * @param participant - The opened participant of a direct chat, or `null`.
 */
export function useDirectCall(
  participant: VirtualParticipant | null,
): DirectCall | null {
  const { calls, start, respond } = useChatCalls();
  const callAudio = useCallAudio();
  const settings = useAudioSettings();
  const [agentCallIds, setAgentCallIds] = useState<readonly string[]>([]);
  if (participant === null) return null;
  if (participant.kind === "agent")
    return {
      phase: agentCallIds.includes(participant.id) ? "active" : null,
      isRunning: agentCallIds.includes(participant.id),
      start: () => setAgentCallIds((ids) => [...ids, participant.id]),
      end: () =>
        setAgentCallIds((ids) => ids.filter((id) => id !== participant.id)),
    };
  const call = calls.find((entry) => entry.participant.id === participant.id);
  const participantId = participant.id;

  async function startCall(): Promise<void> {
    await callAudio.prepare(participantId);
    if (!(await start(participantId))) callAudio.discard(participantId);
  }

  return {
    phase: humanPhase(call),
    isRunning: call !== undefined,
    start: () => void startCall(),
    end: () => {
      if (call !== undefined)
        void respond(call.id, call.status === "active" ? "hangup" : "cancel");
    },
    audio: {
      state: callAudio.state?.callId === call?.id ? callAudio.state : null,
      onToggleMute: callAudio.toggleMute,
      onOpenSettings: settings.open,
    },
  };
}
