/**
 * Contracts of the voice calls of the direct chat with an agent.
 * @remarks
 * The live path keeps one WebSocket open for the whole call
 * ({@link AGENT_CALL_SOCKET_PATH}): the browser sends small blocks of audio
 * while the person speaks and receives preliminary transcripts, the final
 * transcript, and the audio of the answer phrase by phrase while it is still
 * synthesized. The buffered path sends one finished utterance per request and
 * receives a stream of lines of JSON with the audio of each whole sentence.
 * Closing the request or the channel interrupts the answer.
 */

/** The address of the turns and the readiness of an agent call. */
export const AGENT_CALL_ENDPOINT = "/chat-page-api/agent-call";

/** The WebSocket of the live path of an agent call. */
export const AGENT_CALL_SOCKET_PATH = "/chat-page-api/agent-call/socket";

/** The sample rate of the audio blocks the browser sends on the live path. */
export const AGENT_CALL_INPUT_SAMPLE_RATE = 16_000;

/** The bytes before the samples of an audio block: turn and sequence number, each 32-bit little-endian. */
export const AGENT_CALL_AUDIO_HEADER_BYTES = 8;

/** The longest utterance of one turn the server takes, in milliseconds. */
export const AGENT_CALL_MAXIMUM_UTTERANCE_MS = 60_000;

/** The marker a stored answer carries where the call interrupted the speech. */
export const AGENT_CALL_INTERRUPTION_MARKER = " […Anruf unterbrochen…] ";

/** Why no turn started although audio arrived. */
export type AgentCallSilenceReason = "silence" | "empty" | "noise";

/** Why a call or a turn cannot continue; each code names a step that failed. */
export type AgentCallFailure =
  | "recognition_not_configured"
  | "recognition_failed"
  | "synthesis_not_configured"
  | "synthesis_failed"
  | "agent_unavailable"
  | "agent_busy"
  | "invalid";

/** The state of one step of the call: what it needs and whether it is there. */
export type AgentCallStep = "ready" | "not_configured";

/**
 * How a step of the call runs with the chosen connection: `streaming` works
 * while the person speaks or while the voice is synthesized, `buffered`
 * waits for the whole utterance or the whole phrase.
 */
export type AgentCallPath = "streaming" | "buffered";

/**
 * Model families whose PCM arrives only after the whole clip is synthesized,
 * as OpenRouter's speech guide states for MiniMax; their phrases are buffered.
 */
const WHOLE_CLIP_SYNTHESIS_PREFIXES: readonly string[] = ["minimax/"];

/**
 * How a speech output model delivers its audio in a call.
 * @param model - The model name at its connection; `null` for the simulation.
 * @returns `streaming` where audio arrives while a phrase is synthesized.
 */
export function agentCallSynthesisPath(model: string | null): AgentCallPath {
  if (model === null) return "streaming";
  const name = model.toLowerCase();
  return WHOLE_CLIP_SYNTHESIS_PREFIXES.some((prefix) => name.startsWith(prefix))
    ? "buffered"
    : "streaming";
}

/**
 * How a speech recognition connection serves a call.
 * @param provider - The provider of the connection; `null` for the simulation.
 * @returns `streaming` where a call gets preliminary transcripts while the
 * person speaks.
 * @remarks
 * OpenRouter takes whole recordings only, so a call recognizes the growing
 * utterance again at widening steps while it is spoken and once more early
 * in the closing pause; every request is a short, complete recording.
 */
export function agentCallRecognitionPath(
  provider: string | null,
): AgentCallPath {
  return provider === null || provider === "openrouter"
    ? "streaming"
    : "buffered";
}

/** What the call needs before it starts. */
export interface AgentCallReadiness {
  readonly recognition: AgentCallStep;
  readonly synthesis: AgentCallStep;
  /** The saved voice is not offered by the model; the first voice speaks instead. */
  readonly isVoiceMissing: boolean;
  /** Whether the chosen recognition gives preliminary transcripts while the person speaks. */
  readonly recognitionPath: AgentCallPath;
  /** Whether the chosen voice delivers audio while a phrase is still synthesized. */
  readonly synthesisPath: AgentCallPath;
}

/** What the server reports to the browser for one utterance. */
export type AgentCallEvent =
  | { readonly type: "transcript"; readonly text: string }
  | { readonly type: "silent"; readonly reason: AgentCallSilenceReason }
  | { readonly type: "duplicate" }
  | {
      readonly type: "sentence";
      readonly index: number;
      readonly text: string;
      readonly mimeType: "audio/wav" | "audio/mpeg";
      readonly playbackRate: number;
      /** The audio of the sentence, base64 encoded. */
      readonly audio: string;
    }
  | { readonly type: "done"; readonly timings: AgentCallTimings }
  | { readonly type: "failed"; readonly code: AgentCallFailure }
  | { readonly type: "partial"; readonly text: string }
  | AgentCallPhraseEvent
  | {
      readonly type: "audio";
      readonly index: number;
      /** The running number of the block within its phrase, from 0. */
      readonly sequence: number;
      /** The bytes of the block, base64 encoded. */
      readonly audio: string;
    }
  | {
      readonly type: "phraseEnd";
      readonly index: number;
      /** How many audio blocks the phrase has. */
      readonly blocks: number;
    };

/** The start of one phrase of the answer on the live path; its audio follows in blocks. */
export interface AgentCallPhraseEvent {
  readonly type: "phrase";
  readonly index: number;
  readonly text: string;
  /**
   * `audio/pcm` arrives as 16-bit little-endian samples while it is
   * synthesized; any other type arrives as one whole file in one block.
   */
  readonly mimeType: "audio/pcm" | "audio/wav" | "audio/mpeg";
  /** The sample rate of `audio/pcm`; 0 for a whole file. */
  readonly sampleRate: number;
  /** The channels of `audio/pcm`; 0 for a whole file. */
  readonly channels: number;
  readonly playbackRate: number;
}

/** An event of the live path: the event of the turn it belongs to, or the readiness of the call. */
export type AgentCallLiveEvent =
  | (AgentCallEvent & { readonly turn: number })
  | { readonly type: "ready"; readonly readiness: AgentCallReadiness }
  | { readonly type: "closed"; readonly code: AgentCallFailure };

/**
 * What the browser sends on the live path besides the audio blocks.
 * @remarks
 * `hello` opens or resumes the call. `speech` starts an utterance and stops
 * the running answer. `quiet` tells that the person has paused after the
 * given number of blocks, so recognition can start early. `end` closes the
 * utterance after `blocks` blocks, of which the first `voicedBlocks` hold
 * the speech. `cancel` drops an utterance. `played` confirms that a phrase
 * was heard to its end. `spoken` reports how much of an interrupted answer
 * was heard. `hangup` ends the call at once.
 */
export type AgentCallLiveCommand =
  | {
      readonly type: "hello";
      readonly agentId: string;
      readonly callId: string;
    }
  | { readonly type: "speech"; readonly turn: number }
  | { readonly type: "quiet"; readonly turn: number; readonly blocks: number }
  | {
      readonly type: "end";
      readonly turn: number;
      readonly blocks: number;
      readonly voicedBlocks: number;
    }
  | { readonly type: "cancel"; readonly turn: number }
  | { readonly type: "played"; readonly turn: number; readonly index: number }
  | {
      readonly type: "spoken";
      readonly turn: number;
      readonly spokenCharacters: number;
    }
  | { readonly type: "hangup" };

/** The times of one turn the server measured, in milliseconds since its audio was complete. */
export interface AgentCallTimings {
  /** Until the recognized text was there. */
  readonly transcriptMs: number | null;
  /** Until the first sentence of the answer could be spoken. */
  readonly firstSentenceMs: number | null;
  /** Until the audio of the first sentence existed. */
  readonly firstAudioMs: number | null;
  /** Until the answer was complete. */
  readonly answerMs: number | null;
  /** How many preliminary transcripts reached the browser before the end of the speech; live path only. */
  readonly partials?: number;
  /** Whether the final transcript reused the recognition that ran during the pause; live path only. */
  readonly isEarlyFinal?: boolean;
  /** How many phrases arrived as whole files instead of streamed audio; live path only. */
  readonly bufferedPhrases?: number;
}

/** What the browser tells the server about an answer that was interrupted. */
export interface AgentCallSpokenReport {
  readonly agentId: string;
  readonly callId: string;
  readonly turn: number;
  /** How many characters of the answer the person actually heard. */
  readonly spokenCharacters: number;
}
