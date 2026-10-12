import { readAgentObject } from "@/backend/agents/AgentPayload";
import { isChatSessionId } from "@/definition/Chat";

import type {
  ChatAttachment,
  ChatConfirmationWord,
  ChatMessage,
  ChatOverview,
  ChatReply,
  ChatSession,
  ChatSessionView,
} from "@/definition/Chat";
import type { ChatTemporaryPassword } from "@/definition/AgentAdministration";

/** A failed chat request with the stable code the server sent. */
export class ChatClientError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = "ChatClientError";
    this.code = code;
  }
}

function readText(value: unknown): string {
  if (typeof value !== "string") throw new ChatClientError("general");
  return value;
}

function readSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new ChatClientError("general");
  return value;
}

function readList(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new ChatClientError("general");
  return value;
}

function readAttachment(value: unknown): ChatAttachment {
  const attachment = readAgentObject(value);
  return {
    id: readText(attachment.id),
    fileName: readText(attachment.fileName),
    contentType: readText(attachment.contentType),
    size: readSize(attachment.size),
  };
}

function readMessage(value: unknown): ChatMessage {
  const message = readAgentObject(value);
  if (message.role !== "user" && message.role !== "assistant")
    throw new ChatClientError("general");
  return {
    id: readText(message.id),
    role: message.role,
    content: readText(message.content),
    createdAt: readText(message.createdAt),
    attachments: readList(message.attachments).map(readAttachment),
  };
}

function readTemporaryPassword(value: unknown): ChatTemporaryPassword {
  const receipt = readAgentObject(value);
  return {
    userId: readText(receipt.userId),
    username: readText(receipt.username),
    temporaryPassword: readText(receipt.temporaryPassword),
  };
}

function readSession(value: unknown): ChatSession {
  const session = readAgentObject(value);
  if (!isChatSessionId(session.id)) throw new ChatClientError("general");
  return {
    id: session.id,
    createdAt: readText(session.createdAt),
    lastMessageAt: readText(session.lastMessageAt),
    preview: readText(session.preview),
  };
}

function readConfirmationWord(value: unknown): ChatConfirmationWord {
  if (value !== "LÖSCHEN" && value !== "DELETE")
    throw new ChatClientError("general");
  return value;
}

/** Reads one session with its messages and unsent attachments. */
export function readChatSessionView(value: unknown): ChatSessionView {
  const view = readAgentObject(value);
  return {
    session: readSession(view.session),
    messages: readList(view.messages).map(readMessage),
    pending: readList(view.pending).map(readAttachment),
  };
}

/** Reads what the panel needs when it opens. */
export function readChatOverview(value: unknown): ChatOverview {
  const overview = readAgentObject(value);
  return {
    ...readChatSessionView(overview),
    attachmentLimitBytes: readSize(overview.attachmentLimitBytes),
    confirmationWord: readConfirmationWord(overview.confirmationWord),
  };
}

/** Reads the outcome of a sent message. */
export function readChatReply(value: unknown): ChatReply {
  const reply = readAgentObject(value);
  return {
    session: readSession(reply.session),
    question: readMessage(reply.question),
    answer: readMessage(reply.answer),
    ...(reply.temporaryPasswords === undefined
      ? {}
      : {
          temporaryPasswords: readList(reply.temporaryPasswords).map(
            readTemporaryPassword,
          ),
        }),
  };
}

/** Reads the person's own sessions. */
export function readChatSessions(value: unknown): readonly ChatSession[] {
  return readList(value).map(readSession);
}

/** Sends one intent to the chat interface and returns its answer. */
export async function chatApi(
  input: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch("/chat-api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  return readResult(response);
}

/** Uploads a file for the next message of a session. */
export async function uploadChatAttachment(
  sessionId: string,
  file: File,
): Promise<ChatAttachment> {
  const query = new URLSearchParams({ session: sessionId, name: file.name });
  const response = await fetch(`/chat-api/attachments?${query.toString()}`, {
    method: "PUT",
    body: file,
  });
  return readAttachment((await readResult(response)).attachment);
}

/** Tells the code of a failure; anything unexpected is `general`. */
export function chatErrorCode(error: unknown): string {
  if (error instanceof ChatClientError) return error.code;
  if (error instanceof DOMException && error.name === "AbortError")
    return "cancelled";
  return "general";
}

async function readResult(
  response: Response,
): Promise<Record<string, unknown>> {
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    throw new ChatClientError("general");
  }
  const result = readAgentObject(parsed);
  if (!response.ok || result.ok !== true)
    throw new ChatClientError(
      typeof result.error === "string" ? result.error : "general",
    );
  return result;
}
