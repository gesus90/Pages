import { z } from "zod";

import type {
  ConversationContacts,
  ConversationErrorCode,
  ConversationHistoryPage,
  ConversationListPage,
  ConversationMessage,
  ConversationReadState,
  ConversationSummary,
} from "./Conversation";

/** Most decoded bytes one `voice_chunk` carries. */
export const PICA_MOBILE_MAXIMUM_VOICE_CHUNK_BYTES = 65_536;

/** Longest Base64 text of one `voice_chunk`: 65,536 bytes encoded. */
export const PICA_MOBILE_MAXIMUM_VOICE_CHUNK_LENGTH = 87_384;

/** Most chunks one voice message may have: 25 MB in chunks of 64 KB, rounded up. */
export const PICA_MOBILE_MAXIMUM_VOICE_CHUNKS = 400;

/** Message and conversation IDs are short, printable and never a path. */
const conversationIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,100}$/u);

/** Upload IDs are chosen by the app; short, printable and safe to echo. */
const voiceUploadIdSchema = z.string().regex(/^[\w.:-]{1,64}$/u);

/**
 * The requests of `conversations.v1`, each with its payload.
 *
 * @remarks
 * `text` is bounded here by UTF-16 code units only; Pages counts its
 * characters and answers a longer text with `conversation_error`
 * `too_long`, as the web does.
 */
export const picaMobileConversationRequestSchema = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("conversations_list"),
      payload: z.object({ cursor: z.string().max(512).nullable().optional() }),
    }),
    z.object({
      type: z.literal("conversation_history"),
      payload: z.object({
        conversationId: conversationIdSchema,
        beforeId: conversationIdSchema.nullable().optional(),
      }),
    }),
    z.object({
      type: z.literal("conversation_participants"),
      payload: z.object({}),
    }),
    z.object({
      type: z.literal("conversation_create"),
      payload: z.object({
        kind: z.enum(["direct", "group"]),
        participantIds: z.array(conversationIdSchema).min(1).max(100),
        name: z.string().max(200).nullable().optional(),
      }),
    }),
    z.object({
      type: z.literal("conversation_send"),
      payload: z.object({
        conversationId: conversationIdSchema,
        clientMessageId: z.uuid(),
        text: z.string().max(40_000),
      }),
    }),
    z.object({
      type: z.literal("conversation_read"),
      payload: z.object({
        conversationId: conversationIdSchema,
        upToMessageId: conversationIdSchema,
      }),
    }),
    z.object({
      type: z.literal("conversation_mute"),
      payload: z.object({
        conversationId: conversationIdSchema,
        isMuted: z.boolean(),
      }),
    }),
    z.object({
      type: z.literal("voice_start"),
      payload: z.object({
        id: voiceUploadIdSchema,
        conversationId: conversationIdSchema,
        clientMessageId: z.uuid(),
        mimeType: z.string().min(1).max(100),
        durationMs: z.number().int().min(1).max(86_400_000),
      }),
    }),
    z.object({
      type: z.literal("voice_chunk"),
      payload: z.object({
        id: voiceUploadIdSchema,
        index: z
          .number()
          .int()
          .min(0)
          .max(PICA_MOBILE_MAXIMUM_VOICE_CHUNKS - 1),
        data: z
          .string()
          .min(1)
          .max(PICA_MOBILE_MAXIMUM_VOICE_CHUNK_LENGTH)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
      }),
    }),
    z.object({
      type: z.literal("voice_finish"),
      payload: z.object({
        id: voiceUploadIdSchema,
        chunkCount: z
          .number()
          .int()
          .min(1)
          .max(PICA_MOBILE_MAXIMUM_VOICE_CHUNKS),
      }),
    }),
    z.object({
      type: z.literal("voice_cancel"),
      payload: z.object({ id: voiceUploadIdSchema }),
    }),
  ],
);

/** A request of `conversations.v1` with its checked payload, without the envelope. */
export type PicaMobileConversationRequest = z.infer<
  typeof picaMobileConversationRequestSchema
>;

/** The type of a request of `conversations.v1`. */
export type PicaMobileConversationRequestType =
  PicaMobileConversationRequest["type"];

/** The answer to `conversations_list`. */
export type PicaMobileConversationsPayload = ConversationListPage;

/** The answer to `conversation_history`. */
export type PicaMobileConversationMessagesPayload = ConversationHistoryPage;

/** The answer to `conversation_participants`. */
export type PicaMobileConversationParticipantListPayload = ConversationContacts;

/** A typing participant; reserved for the answers of agents (PAGE-276), Pages sends none yet. */
export interface PicaMobileConversationTyping {
  readonly conversationId: string;
  readonly participantId: string;
  readonly isTyping: boolean;
}

/**
 * The payload of `conversation_event`: what happened and its data.
 *
 * @remarks
 * `message` is a new message, `message_updated` a changed one, such as the
 * text of a voice message, `conversation` a new or changed conversation as
 * the member sees it, `read` the member's own read state after a change.
 * The answers to `conversation_create`, `conversation_send`,
 * `conversation_read`, `conversation_mute` and `voice_finish` are events
 * with the request's identifier; Pages sends every other event on its own.
 */
export type PicaMobileConversationEventPayload =
  | {
      readonly type: "message" | "message_updated";
      readonly data: ConversationMessage;
    }
  | { readonly type: "conversation"; readonly data: ConversationSummary }
  | { readonly type: "read"; readonly data: ConversationReadState }
  | { readonly type: "typing"; readonly data: PicaMobileConversationTyping };

/** The payload of `conversation_error`. */
export interface PicaMobileConversationErrorPayload {
  /** The upload of a `voice_*` request, else the conversation it named; `null` when it named none. */
  readonly id: string | null;
  readonly code: ConversationErrorCode;
}

/** An answer of `conversations.v1` without its envelope. */
export type PicaMobileConversationAnswer =
  | {
      readonly type: "conversations";
      readonly payload: PicaMobileConversationsPayload;
    }
  | {
      readonly type: "conversation_messages";
      readonly payload: PicaMobileConversationMessagesPayload;
    }
  | {
      readonly type: "conversation_participant_list";
      readonly payload: PicaMobileConversationParticipantListPayload;
    }
  | {
      readonly type: "conversation_event";
      readonly payload: PicaMobileConversationEventPayload;
    }
  | {
      readonly type: "conversation_error";
      readonly payload: PicaMobileConversationErrorPayload;
    };
