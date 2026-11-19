import { useAgentCall } from "./agent-call/use-agent-call";
import { useAudioSettings } from "./audio-settings-context";
import { useCallAudio } from "./use-call-audio";
import { useChatCalls } from "./use-chat-calls";

import type { ChatCallView } from "@/definition/ChatCall";
import type { AgentCallControl } from "./agent-call/use-agent-call";
import type { CallAudioState } from "./call-audio-session";
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
  /** The audio of the running call, with a person or an agent. */
  readonly audio?: ChatCallBarAudio;
}

function humanPhase(call: ChatCallView | undefined): ChatCallPhase | null {
  if (call === undefined) return null;
  if (call.status === "active") return "active";
  // The recipient of a ringing call answers in the notice, not in the chat.
  return call.isOutgoing ? "waiting" : null;
}

function agentCallOf(
  agentId: string,
  call: AgentCallControl,
  openSettings: () => void,
): DirectCall {
  const { state } = call;
  const isThisAgent = state?.agentId === agentId;
  const audioState: CallAudioState | null =
    state === null || !isThisAgent
      ? null
      : {
          callId: state.callId,
          microphone: state.microphone,
          connection: state.isFailedToStart ? "failed" : "connected",
          route: null,
        };
  return {
    phase: isThisAgent ? "active" : null,
    // One call at a time: another chat's call blocks starting this one.
    isRunning: state !== null,
    start: () => call.start(agentId),
    end: call.end,
    ...(isThisAgent && state !== null
      ? {
          audio: {
            state: audioState,
            onToggleMute: call.toggleMute,
            onOpenSettings: openSettings,
            agent: {
              activity: state.activity,
              failure: state.failure,
              isFailedToStart: state.isFailedToStart,
              isVoiceMissing: state.isVoiceMissing,
              latencies: state.latencies,
            },
          },
        }
      : {}),
  };
}

/**
 * The call of the direct chat with the opened participant.
 * @remarks
 * With an agent the call runs in the page and on the server: the microphone
 * opens when the person starts the call, speech detection on the device cuts
 * out each utterance, the agent answers once per utterance in the same chat
 * session and its voice speaks the answer while it is written. With a person
 * the server keeps the call, so both sides see it, and the microphone opens
 * when the person starts the call; the running call carries voice in both
 * directions. Without a participant, as in a group, no call exists.
 * @param participant - The opened participant of a direct chat, or `null`.
 */
export function useDirectCall(
  participant: VirtualParticipant | null,
): DirectCall | null {
  const { calls, start, respond } = useChatCalls();
  const callAudio = useCallAudio();
  const settings = useAudioSettings();
  const agentCall = useAgentCall();
  if (participant === null) return null;
  if (participant.kind === "agent")
    return agentCallOf(participant.id, agentCall, settings.open);
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
