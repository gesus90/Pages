import type { Readable } from "node:stream";

import type { ConversationEvent } from "@/backend/service/conversation/ConversationEvents";
import type {
  ConversationErrorCode,
  ConversationVoice,
} from "@/definition/Conversation";
import type {
  PicaMobileConversationAnswer,
  PicaMobileConversationEventPayload,
  PicaMobileConversationRequest,
} from "@/definition/PicaMobileConversations";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";

/** The requests a provider answers directly; the voice upload has its own steps. */
export type PicaMobileConversationQuery = Exclude<
  PicaMobileConversationRequest,
  { readonly type: `voice_${string}` }
>;

/** The checked payload of a `voice_start`. */
export type PicaMobileVoiceStart = Extract<
  PicaMobileConversationRequest,
  { readonly type: "voice_start" }
>["payload"];

/** What a conversation request is answered for. */
export interface PicaMobileConversationContext {
  readonly session: PicaMobileSessionIdentity;
  /** The connection that asks; its own changes come back as answers, not as events. */
  readonly originId: string;
}

/**
 * The answer to a conversation request.
 *
 * @remarks
 * `sessionEnded` means the session or the account no longer holds; the
 * connection ends as it does when its regular session check fails.
 */
export type PicaMobileConversationOutcome =
  | { readonly kind: "answer"; readonly answer: PicaMobileConversationAnswer }
  | { readonly kind: "sessionEnded" };

/** Takes the audio of one voice message chunk by chunk. */
export interface PicaMobileVoiceSink {
  /** Hands over the next chunk; the store writes it behind the previous ones. */
  write(chunk: Buffer): void;
  /** Ends the audio and sends the voice message. */
  finish(): Promise<PicaMobileConversationOutcome>;
  /** Drops the audio; nothing remains. */
  cancel(): void;
}

/** The answer to a `voice_start`. */
export type PicaMobileVoiceStartOutcome =
  | { readonly kind: "started"; readonly sink: PicaMobileVoiceSink }
  | { readonly kind: "failed"; readonly code: ConversationErrorCode }
  | { readonly kind: "sessionEnded" };

/** The answer to a request for the audio of a voice message. */
export type PicaMobileVoiceFileOutcome =
  | {
      readonly kind: "opened";
      readonly voice: ConversationVoice;
      readonly stream: Readable;
    }
  | { readonly kind: "notFound" }
  | { readonly kind: "sessionEnded" };

/**
 * The business answers of an authenticated Pica Mobile connection for
 * `conversations.v1` (PAGE-278).
 *
 * @remarks
 * A connection without a provider does not announce `conversations.v1`,
 * answers its requests as unknown and the voice address with 426. Every call
 * reads the account behind the session first and acts with its rights only.
 */
export interface PicaMobileConversationsProvider {
  /** Answers one request other than the voice upload; rejects only when Pages cannot decide right now. */
  answer(
    context: PicaMobileConversationContext,
    request: PicaMobileConversationQuery,
  ): Promise<PicaMobileConversationOutcome>;
  /** Checks an announced voice message and opens the store for its audio. */
  beginVoice(
    context: PicaMobileConversationContext,
    start: PicaMobileVoiceStart,
  ): Promise<PicaMobileVoiceStartOutcome>;
  /** Opens the audio of a voice message of a conversation of the account. */
  openVoice(
    session: PicaMobileSessionIdentity,
    messageId: string,
  ): Promise<PicaMobileVoiceFileOutcome>;
  /**
   * Builds the event an account receives for a committed change.
   *
   * @returns The payload, `null` when the account no longer sees the
   * conversation, or `sessionEnded`.
   */
  describe(
    session: PicaMobileSessionIdentity,
    event: ConversationEvent,
  ): Promise<PicaMobileConversationEventPayload | null | "sessionEnded">;
  /**
   * Follows the committed changes of conversations.
   *
   * @returns Stops following.
   */
  follow(listener: (event: ConversationEvent) => void): () => void;
}
