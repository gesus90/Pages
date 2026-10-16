import type { AgentProviderId } from "./AgentConnection";
import type { ChatTemporaryPassword } from "./AgentAdministration";
import type { ChatSession } from "./ChatSessionOperations.js";
import type { ChatJobStart, ChatSessionActivity, ChatSteer } from "./ChatJob";

export type {
  ChatSession,
  ChatDeletionResult,
} from "./ChatSessionOperations.js";

/** One mebibyte; attachment limits are configured in whole mebibytes. */
export const CHAT_MEBIBYTE = 1024 * 1024;

/** Default and allowed range of the size of one chat attachment (T6.12.4). */
export const CHAT_ATTACHMENT_LIMITS = {
  defaultMegabytes: 16,
  minimumMegabytes: 1,
  maximumMegabytes: 512,
} as const;

/** Fixed bounds of chat input, output and the administrator instruction. */
export const CHAT_LIMITS = {
  messageCharacters: 20_000,
  answerCharacters: 200_000,
  instructionCharacters: 20_000,
  attachmentsPerMessage: 10,
  fileNameCharacters: 255,
  sessionsListed: 200,
} as const;

/** Chat commands that act on the person's own sessions (T6.12.3). */
export const CHAT_COMMANDS = [
  "/new",
  "/sessions",
  "/delete",
  "/compact",
] as const;

/** A chat command typed into the input field. */
export type ChatCommand = (typeof CHAT_COMMANDS)[number];

/** The word a person types to confirm a deletion, by interface language. */
export type ChatConfirmationWord = "LÖSCHEN" | "DELETE";

/**
 * Providers whose own search function the chat may use (T6.12.6).
 *
 * @remarks
 * Every other provider answers without internet search; the chat never adds a
 * search of its own.
 */
export const CHAT_WEB_SEARCH_PROVIDERS: readonly AgentProviderId[] = [
  "openai",
  "anthropic",
  "google_ai_studio",
  "openrouter",
  "codex_cli",
  "claude_code",
];

/** A file attached to a session; the type was determined from its content. */
export interface ChatAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
}

/** A message of a session, with the attachments sent along with it. */
export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly attachments: readonly ChatAttachment[];
  /**
   * The person stopped this answer of Pica before it ended; it holds what the
   * agent had written until then (PAGE-90). Absent for every other message.
   */
  readonly isStopped?: boolean;
}

/** Administrator settings of the chat; access and model belong to the agents panel. */
export interface ChatSettings {
  readonly attachmentLimitBytes: number;
  /**
   * Markdown supplement of the administrator, added below Pica's protected
   * `SOUL.md` and `AGENTS.md`; `null` when none is saved.
   */
  readonly systemInstruction: string | null;
}

/** The settings of the chat as the system settings page shows them. */
export interface ChatAdministration {
  readonly attachmentLimitMegabytes: number;
  /** The saved supplement; empty when none is saved. */
  readonly systemInstruction: string;
  /** Whether Pica works with its protected instructions alone, without a supplement. */
  readonly isDefaultInstruction: boolean;
}

/** What the chat panel shows for one session. */
export interface ChatSessionView {
  readonly session: ChatSession;
  readonly messages: readonly ChatMessage[];
  /** Attachments uploaded for the next message and not sent yet. */
  readonly pending: readonly ChatAttachment[];
  /** Jobs, steers and selection snapshots of the Codex path (PAGE-68). */
  readonly activity?: ChatSessionActivity;
}

/** What the chat panel needs when it opens. */
export interface ChatOverview extends ChatSessionView {
  readonly attachmentLimitBytes: number;
  readonly confirmationWord: ChatConfirmationWord;
}

/** The outcome of one sent message. */
export interface ChatReply {
  readonly session: ChatSession;
  readonly question: ChatMessage;
  readonly answer: ChatMessage;
  /** One-time receipts for the signed-in administrator; absent from stored conversation history. */
  readonly temporaryPasswords?: readonly ChatTemporaryPassword[];
}

/** What became of a sent message: an answer, a job that runs on, or a steer into a running job. */
export type ChatSendResult =
  | { readonly kind: "reply"; readonly reply: ChatReply }
  | { readonly kind: "job"; readonly job: ChatJobStart }
  | { readonly kind: "steer"; readonly steer: ChatSteer };

/** Session IDs are five lowercase words joined by hyphens (T6.12.2). */
export const CHAT_SESSION_ID_PATTERN = /^[a-z]{2,12}(?:-[a-z]{2,12}){4}$/u;

/** Narrows an external session ID without interpreting it as a path or SQL fragment. */
export function isChatSessionId(value: unknown): value is string {
  return typeof value === "string" && CHAT_SESSION_ID_PATTERN.test(value);
}

/** Recognizes a typed chat command; anything else is a message for the agent. */
export function readChatCommand(text: string): ChatCommand | null {
  const command = text.trim().toLowerCase();
  return CHAT_COMMANDS.find((entry) => entry === command) ?? null;
}

/** Tells whether the chat may use the search function of a provider. */
export function canChatSearchWeb(provider: AgentProviderId): boolean {
  return CHAT_WEB_SEARCH_PROVIDERS.includes(provider);
}

/** Conversation-only context estimate; provider instructions and tool results are excluded. */
export interface ChatContextSize {
  readonly tokens: number | null;
  readonly limit: number | null;
  readonly isEstimated: boolean;
  /** `adapter`: the occupancy the ACP adapter reported last, not an estimate of Pages. */
  readonly source?: "adapter";
}

/** The manual compaction result; the displayed transcript is never replaced. */
export interface ChatCompactionResult {
  readonly status: "compacted" | "notNeeded";
  readonly context: ChatContextSize;
}
