/**
 * Contracts of the voice calls of the direct chat with an agent.
 * @remarks
 * The browser detects the speech of the person and sends one finished
 * utterance per request. The server answers with a stream of lines of JSON:
 * the recognized text, then every spoken sentence of the answer as soon as
 * its audio exists, then the end. Closing the request interrupts the answer.
 */

/** The address of the turns and the readiness of an agent call. */
export const AGENT_CALL_ENDPOINT = "/chat-page-api/agent-call";

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

/** What the call needs before it starts. */
export interface AgentCallReadiness {
  readonly recognition: AgentCallStep;
  readonly synthesis: AgentCallStep;
  /** The saved voice is not offered by the model; the first voice speaks instead. */
  readonly isVoiceMissing: boolean;
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
  | { readonly type: "failed"; readonly code: AgentCallFailure };

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
}

/** What the browser tells the server about an answer that was interrupted. */
export interface AgentCallSpokenReport {
  readonly agentId: string;
  readonly callId: string;
  readonly turn: number;
  /** How many characters of the answer the person actually heard. */
  readonly spokenCharacters: number;
}
