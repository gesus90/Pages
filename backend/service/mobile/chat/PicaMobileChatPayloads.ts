import { ChatError } from "@/backend/error/ChatErrors";
import { PICA_MOBILE_MAXIMUM_CHAT_FRAME_LENGTH } from "@/definition/PicaMobileProtocol";

import type {
  ChatAttachment,
  ChatMessage,
  ChatOverview,
  ChatSession,
  ChatSessionView,
} from "@/definition/Chat";
import type {
  ChatJobEntry,
  ChatJobEvent,
  ChatJobUpdate,
} from "@/definition/ChatJob";
import type {
  PicaMobileChatAttachment,
  PicaMobileChatJobEvent,
  PicaMobileChatJobPayload,
  PicaMobileChatMessage,
  PicaMobileChatSessionsPayload,
  PicaMobileChatViewPayload,
} from "@/definition/PicaMobileProtocol";

/** Messages one `chat_view` page holds at most. */
const PAGE_MESSAGES = 30;

/** Characters of message content one `chat_view` page holds at most. */
const PAGE_CHARACTERS = 400_000;

/** Journal characters one `chat_job` page holds at most. */
const JOB_PAGE_CHARACTERS = 200_000;

/** Sessions `chat_sessions` lists at most. */
const LISTED_SESSIONS = 200;

/** Characters of a session preview in `chat_sessions`. */
const PREVIEW_CHARACTERS = 120;

/** Room of the envelope: version, type, a 64 character request ID and the keys. */
const ENVELOPE_RESERVE = 512;

/** A selected page of messages and where it starts in the conversation. */
interface MessagePage {
  readonly messages: readonly PicaMobileChatMessage[];
  readonly start: number;
}

/** Length of a text inside a JSON frame, without its quotes. */
function encodedLength(text: string): number {
  return JSON.stringify(text).length - 2;
}

function toAttachment(attachment: ChatAttachment): PicaMobileChatAttachment {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
    ...(attachment.origin === "assistant" ? { origin: "assistant" } : {}),
  };
}

function toMessage(message: ChatMessage): PicaMobileChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    attachments: message.attachments.map(toAttachment),
    ...(message.isStopped === true ? { isStopped: true } : {}),
  };
}

/**
 * Shortens the content of a message until it fits the room of the frame.
 *
 * @remarks
 * A surrogate pair is never split, so the text stays well-formed.
 */
function cutMessage(
  message: PicaMobileChatMessage,
  budget: number,
): PicaMobileChatMessage {
  const room =
    budget - JSON.stringify({ ...message, content: "", isCut: true }).length;
  let content = message.content.slice(0, PAGE_CHARACTERS);

  while (content.length > 0 && encodedLength(content) > room) {
    const ratio = Math.max(room, 0) / encodedLength(content);

    content = content.slice(
      0,
      Math.min(content.length - 1, Math.floor(content.length * ratio)),
    );
  }

  if (/[\uD800-\uDBFF]$/u.test(content)) {
    content = content.slice(0, -1);
  }

  return { ...message, content, isCut: true };
}

/**
 * Selects the newest messages before `end` that fit one page.
 *
 * @remarks
 * The newest message of the page is always taken; when it alone does not fit,
 * its content is shortened.
 */
function selectPage(
  messages: readonly ChatMessage[],
  end: number,
  budget: number,
): MessagePage {
  const page: PicaMobileChatMessage[] = [];
  let characters = 0;
  let size = 0;
  let start = end;

  while (start > 0 && page.length < PAGE_MESSAGES) {
    const message = toMessage(messages[start - 1]);
    const encoded = JSON.stringify(message).length + 1;
    const isFitting =
      characters + message.content.length <= PAGE_CHARACTERS &&
      size + encoded <= budget;

    if (!isFitting) {
      // Only the newest message of a page is shortened; an older one waits for the next page.
      return page.length > 0
        ? { messages: page, start }
        : { messages: [cutMessage(message, budget)], start: start - 1 };
    }

    page.unshift(message);
    characters += message.content.length;
    size += encoded;
    start -= 1;
  }

  return { messages: page, start };
}

/** Where the page ends: before the named message, or at the newest one. */
function pageEnd(
  messages: readonly ChatMessage[],
  before: string | undefined,
): number {
  if (before === undefined) {
    return messages.length;
  }

  const index = messages.findIndex((message) => message.id === before);

  if (index < 0) {
    throw new ChatError("invalidInput");
  }

  return index;
}

/**
 * Builds a `chat_view` answer: the session with one page of its messages.
 *
 * @param view - The session as the chat reads it, for `chat_open` with its limits.
 * @param before - The message the page ends before; the newest page without it.
 * @returns The payload; it stays within the frame limit of `chat.v1`.
 * @throws {ChatError} `invalidInput` when `before` is no message of the session.
 */
export function toPicaMobileChatView(
  view: ChatSessionView | ChatOverview,
  before?: string,
): PicaMobileChatViewPayload {
  const job = view.activity?.job ?? null;
  const base: PicaMobileChatViewPayload = {
    session: toSession(view.session),
    messages: [],
    hasOlder: false,
    pending: view.pending.map(toAttachment),
    job:
      job === null
        ? null
        : { id: job.id, state: job.state, errorCode: job.errorCode },
    steers: (view.activity?.steers ?? []).map((steer) => ({
      messageId: steer.messageId,
      status: steer.status,
    })),
    ...("attachmentLimitBytes" in view
      ? {
          attachmentLimitBytes: view.attachmentLimitBytes,
        }
      : {}),
  };
  const budget =
    PICA_MOBILE_MAXIMUM_CHAT_FRAME_LENGTH -
    ENVELOPE_RESERVE -
    JSON.stringify(base).length;
  const page = selectPage(
    view.messages,
    pageEnd(view.messages, before),
    budget,
  );

  return { ...base, messages: page.messages, hasOlder: page.start > 0 };
}

function toSession(session: ChatSession): PicaMobileChatViewPayload["session"] {
  return {
    id: session.id,
    createdAt: session.createdAt,
    lastMessageAt: session.lastMessageAt,
    preview: session.preview,
  };
}

/**
 * Builds a `chat_sessions` answer from the own sessions, newest first.
 *
 * @param sessions - The sessions as the chat lists them.
 * @returns At most 200 sessions with previews of at most 120 characters.
 */
export function toPicaMobileChatSessions(
  sessions: readonly ChatSession[],
): PicaMobileChatSessionsPayload {
  return {
    sessions: sessions.slice(0, LISTED_SESSIONS).map((session) => ({
      id: session.id,
      lastMessageAt: session.lastMessageAt,
      preview: Array.from(session.preview)
        .slice(0, PREVIEW_CHARACTERS)
        .join(""),
    })),
  };
}

/** The entry as `chat.v1` transfers it; `null` for every other kind. */
function toJobEvent(event: ChatJobEvent): PicaMobileChatJobEvent | null {
  switch (event.kind) {
    case "turn":
      return {
        kind: "turn",
        turn: event.turn,
        origin: event.origin,
        ...(event.startedAt === undefined
          ? {}
          : { startedAt: event.startedAt }),
      };
    case "text":
      return {
        kind: "text",
        turn: event.turn,
        isReset: event.isReset,
        delta: event.delta,
      };
    case "steer":
      return {
        kind: "steer",
        messageId: event.messageId,
        status: event.status,
      };
    case "answer":
      return { kind: "answer", turn: event.turn, messageId: event.messageId };
    case "end":
      return { kind: "end", state: event.state, errorCode: event.errorCode };
    case "session":
    case "phase":
    case "tool":
    case "usage":
    case "compaction":
    case "capabilities":
      return null;
  }
}

/**
 * Builds a `chat_job` answer from a read of the journal.
 *
 * @param update - The job with the journal after the cursor, or `null`.
 * @returns Only the five entry kinds of `chat.v1`; `cursor` counts every
 * entry read, also the ones left out. When the entries exceed 200000
 * characters the page ends before and `hasMore` is `true`.
 */
export function toPicaMobileChatJob(
  update: ChatJobUpdate | null,
): PicaMobileChatJobPayload {
  if (update === null) {
    return { jobId: null };
  }

  const events: { sequence: number; event: PicaMobileChatJobEvent }[] = [];
  let cursor = update.cursor;
  let characters = 0;
  let isCut = false;

  for (const entry of update.events) {
    const transferred = toTransferredEntry(entry);
    const size = transferred === null ? 0 : JSON.stringify(transferred).length;

    if (events.length > 0 && characters + size > JOB_PAGE_CHARACTERS) {
      isCut = true;
      break;
    }

    if (transferred !== null) {
      events.push(transferred);
    }

    characters += size;
    cursor = entry.sequence;
  }

  return {
    jobId: update.job.id,
    state: update.job.state,
    errorCode: update.job.errorCode,
    cursor: isCut ? cursor : update.cursor,
    hasMore: isCut || update.hasMore,
    events,
  };
}

function toTransferredEntry(
  entry: ChatJobEntry,
): { sequence: number; event: PicaMobileChatJobEvent } | null {
  const event = toJobEvent(entry.event);

  return event === null ? null : { sequence: entry.sequence, event };
}
