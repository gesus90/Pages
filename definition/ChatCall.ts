/**
 * Contracts of the calls of the direct chat between two people.
 * @remarks
 * The server keeps who rings whom and whether the call was accepted. Once
 * accepted, the two browsers send their voice directly to each other (WebRTC,
 * one audio track each); the server only passes on their connection offers,
 * answers and ICE candidates and issues short-lived TURN credentials, and
 * every such step checks account, participation and the state of the call.
 * The server never touches the audio itself.
 */

/** Whether the other person has not answered yet or the call was accepted. */
export type ChatCallStatus = "ringing" | "active";

/** The actions a request may name. */
export const CHAT_CALL_ACTIONS = [
  "accept",
  "decline",
  "cancel",
  "hangup",
] as const;

/** What a person does with a call: the recipient accepts or declines, the caller cancels, either hangs up. */
export type ChatCallAction = (typeof CHAT_CALL_ACTIONS)[number];

/** The other person of a call, as the signed-in account sees them. */
export interface ChatCallParticipant {
  /** The user ID of the other person, which names their direct chat. */
  readonly id: string;
  readonly name: string;
  readonly avatarImageUrl: string | null;
}

/** One call of the signed-in account. */
export interface ChatCallView {
  readonly id: string;
  readonly status: ChatCallStatus;
  /** Whether the signed-in account placed the call; the other one is called. */
  readonly isOutgoing: boolean;
  readonly participant: ChatCallParticipant;
}

/** The calls of the signed-in account: at most one per direct chat. */
export interface ChatCallList {
  readonly calls: readonly ChatCallView[];
}

/** The address of the calls of the chat page. */
export const CHAT_CALLS_ENDPOINT = "/chat-page-api/calls";

/** The address of the signaling and the ICE servers of an accepted call. */
export const CHAT_CALL_MEDIA_ENDPOINT = "/chat-page-api/call-media";

/** The longest session description or candidate line the server passes on, in characters. */
export const CHAT_CALL_SIGNAL_MAXIMUM_CHARACTERS = 20_000;

/** A session description of the call, which the caller offers and the recipient answers. */
export interface ChatCallDescriptionSignal {
  readonly kind: "offer" | "answer";
  /** The SDP text of the description. */
  readonly description: string;
}

/** One ICE candidate a browser found, or the end of its candidates. */
export interface ChatCallCandidateSignal {
  readonly kind: "candidate";
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
  readonly usernameFragment: string | null;
}

/** What a browser tells the other one while the connection builds up. */
export type ChatCallSignal =
  ChatCallDescriptionSignal | ChatCallCandidateSignal;

/** A signal of the other person with its position in the order of the call. */
export interface ChatCallSignalMessage {
  readonly sequence: number;
  readonly signal: ChatCallSignal;
}

/** The signals of the other person a request reads, and whether the call is over. */
export interface ChatCallSignalBatch {
  readonly signals: readonly ChatCallSignalMessage[];
  /** The call ended while the request waited; nothing more will come. */
  readonly isEnded: boolean;
}

/** One STUN or TURN server of the connection. */
export interface ChatCallIceServer {
  readonly urls: readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

/** The servers a browser uses to find its way to the other one. */
export interface ChatCallIceConfiguration {
  readonly iceServers: readonly ChatCallIceServer[];
  /** Whether the audio must run over the TURN relay. */
  readonly isRelayOnly: boolean;
}

/** Recognizes the list a request for the calls answers with. */
export function isChatCallList(value: unknown): value is ChatCallList {
  return (
    typeof value === "object" &&
    value !== null &&
    "calls" in value &&
    Array.isArray(value.calls)
  );
}

/** Recognizes the signals a request for the call media answers with. */
export function isChatCallSignalBatch(
  value: unknown,
): value is ChatCallSignalBatch {
  return (
    typeof value === "object" &&
    value !== null &&
    "signals" in value &&
    Array.isArray(value.signals) &&
    "isEnded" in value &&
    typeof value.isEnded === "boolean"
  );
}

/** Recognizes the ICE servers a request for the call media answers with. */
export function isChatCallIceConfiguration(
  value: unknown,
): value is ChatCallIceConfiguration {
  return (
    typeof value === "object" &&
    value !== null &&
    "iceServers" in value &&
    Array.isArray(value.iceServers) &&
    "isRelayOnly" in value &&
    typeof value.isRelayOnly === "boolean"
  );
}
