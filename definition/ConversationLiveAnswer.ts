import type { AgentAnswerModel } from "./AgentChatControl";
import type { VirtualToolUse } from "./VirtualChat";

/**
 * The parts of an answer an agent is writing now, as `conversations.v1`
 * streams them to the chat page of the web.
 * @remarks
 * Every part names its chat, its agent and the answer it belongs to, and
 * counts from 1 within that answer, so a client that receives a part twice,
 * for example once in a snapshot after a reconnect and once as an event,
 * keeps it once. After `answer_end` the stored message holds the answer.
 * Thought parts reach only the readers allowed to see them: the person of a
 * direct chat, the owner of a group.
 */

/**
 * Where an answer is written: `agent` is the direct chat of a person with an
 * agent, whose ID is the agent's; `conversation` a stored conversation, such
 * as a group, whose ID is the conversation's.
 */
export type LiveAnswerChatKind = "agent" | "conversation";

/** What a tool call of an answer is doing. */
export type LiveAnswerToolStatus =
  "running" | "completed" | "failed" | "cancelled";

/** How a message sent during an answer reached the agent. */
export type LiveAnswerDelivery = "injected" | "waiting" | "failed";

/** How an answer ended. */
export type LiveAnswerEndState = "answered" | "stopped" | "failed";

/** How a person sends a message while an agent answers. */
export type ConversationDelivery = "steer" | "after";

/** What every part of a live answer names. */
export interface LiveAnswerHead {
  readonly chatKind: LiveAnswerChatKind;
  readonly chatId: string;
  readonly agentId: string;
  /** The answer being written; a new turn of a direct chat is a new answer. */
  readonly answerId: string;
  /** The number of the part within its answer, from 1. */
  readonly seq: number;
  /** ISO time the server produced the part. */
  readonly at: string;
  /** ISO time the server began this answer. */
  readonly answerStartedAt?: string;
}

/** One tool call of an answer. */
export interface LiveAnswerTool {
  readonly callId: string;
  readonly name: string;
  readonly status: LiveAnswerToolStatus;
  readonly summary?: string;
  /** The command or input, bounded, credentials masked. */
  readonly input?: string;
  /** The result, bounded, credentials masked. */
  readonly output?: string;
  readonly error?: string | null;
  /** A tool of the host rather than a Pages tool. */
  readonly isNative?: boolean;
  readonly startedAt: string;
  /** Absent while the call runs. */
  readonly endedAt?: string;
}

/** The thoughts of an answer, for a reader allowed to see them. */
export interface LiveAnswerThought {
  readonly text: string;
  readonly startedAt: string;
  /** ISO time of the last thought part; the answer went on with text or tools after it. */
  readonly endedAt: string;
}

/** How an answer ended. */
export interface LiveAnswerEnd {
  /** The stored message that replaces the live answer; `null` without one. */
  readonly messageId: string | null;
  readonly state: LiveAnswerEndState;
  /** ISO time the server completed the answer. */
  readonly endedAt?: string;
}

/** The completed measurement and tool calls saved with an agent's answer. */
export interface StoredAgentAnswer {
  readonly answerId: string;
  readonly durationMs: number;
  readonly tools: readonly LiveAnswerTool[];
}

/** The server sent every snapshot for this connection's sign-in. */
export interface LiveAnswerSyncComplete {
  readonly type: "answer_sync_complete";
  readonly data: Record<string, never>;
}

/** Everything known of an answer, for a client that connects while it is written. */
export interface LiveAnswerSnapshot extends LiveAnswerHead {
  /** The model resolved for this answer, once its connection is known. */
  readonly model?: AgentAnswerModel;
  readonly startedAt: string;
  readonly text: string;
  /** `null` without thoughts or for a reader who may not see them. */
  readonly thought: LiveAnswerThought | null;
  readonly tools: readonly LiveAnswerTool[];
  /** `null` while the answer is written. */
  readonly end: LiveAnswerEnd | null;
}

/** The `conversation_event` payloads of a live answer. */
export type LiveAnswerEventPayload =
  | {
      readonly type: "answer_text";
      readonly data: LiveAnswerHead & {
        readonly delta: string;
        /** The text so far is replaced by the delta, for example after a tool call. */
        readonly isReset: boolean;
      };
    }
  | {
      readonly type: "answer_thought";
      readonly data: LiveAnswerHead & {
        readonly delta: string;
        readonly startedAt: string;
      };
    }
  | {
      readonly type: "answer_tool";
      readonly data: LiveAnswerHead & { readonly tool: LiveAnswerTool };
    }
  | {
      readonly type: "answer_steer";
      readonly data: LiveAnswerHead & {
        readonly messageId: string;
        readonly delivery: LiveAnswerDelivery;
      };
    }
  | {
      readonly type: "answer_end";
      readonly data: LiveAnswerHead & LiveAnswerEnd;
    }
  | { readonly type: "answer_snapshot"; readonly data: LiveAnswerSnapshot };

/** The type of a live answer payload. */
export type LiveAnswerEventType = LiveAnswerEventPayload["type"];

/** The types of the live answer payloads, for a client that tells them from the others. */
export const LIVE_ANSWER_EVENT_TYPES: readonly LiveAnswerEventType[] = [
  "answer_text",
  "answer_thought",
  "answer_tool",
  "answer_steer",
  "answer_end",
  "answer_snapshot",
];

/** The WebSocket path of `conversations.v1` on the Pages port for the signed-in browser. */
export const CONVERSATION_WEB_SOCKET_PATH = "/chat/conversations/socket";

/** Maps a tool's own timestamps and details to the row in the chat history. */
export function virtualLiveToolUse(
  tool: LiveAnswerTool,
  now?: number,
): VirtualToolUse {
  const end = tool.endedAt === undefined ? now : Date.parse(tool.endedAt);
  return {
    name: tool.name,
    detail: tool.error ?? "",
    callId: tool.callId,
    status: tool.status,
    ...(tool.input === undefined ? {} : { input: tool.input }),
    ...(tool.output === undefined ? {} : { output: tool.output }),
    ...(tool.isNative === true ? { isNative: true } : {}),
    ...(tool.summary === undefined ? {} : { summary: tool.summary }),
    ...(end === undefined
      ? {}
      : { durationMs: Math.max(0, end - Date.parse(tool.startedAt)) }),
  };
}
