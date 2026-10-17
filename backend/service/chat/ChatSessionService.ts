import { ChatError } from "@/backend/error/ChatErrors";
import { isChatSessionId } from "@/definition/Chat";
import { logCaughtError } from "@/backend/logging/Logger";

import { createChatSessionId } from "./ChatSessionWords";

import type { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type { StoredChatAttachment } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type {
  ChatAttachment,
  ChatConfirmationWord,
  ChatDeletionResult,
  ChatOverview,
  ChatSession,
  ChatSessionView,
} from "@/definition/Chat";
import type { ChatSessionActivity } from "@/definition/ChatJob";
import type { User } from "@/definition/User";
import type { ChatSettingsService } from "./ChatSettingsService";

/** Attempts to draw an unused ID before the service gives up. */
const ID_ATTEMPTS = 5;

/** What the session commands are built from. */
export interface ChatSessionDependencies {
  readonly sessions: Pick<
    ChatSessionRepository,
    "list" | "find" | "exists" | "create" | "remove" | "messages"
  >;
  readonly attachments: Pick<ChatAttachmentRepository, "list">;
  readonly settings: Pick<ChatSettingsService, "read">;
  readonly languages: Pick<UserSettingsRepository, "findByUserId">;
  readonly files: Pick<WikiFileStore, "remove">;
  /** Draws a session ID; five random words by default. */
  readonly createId?: () => string;
  /** Jobs, steers and selection snapshots of the Codex path; absent without it. */
  readonly activity?: (
    userId: string,
    sessionId: string,
  ) => Promise<ChatSessionActivity>;
}

/** What deleting a session also ends: its running job before, its files after. */
export interface ChatSessionDeletionEffects {
  /** Stops the job of the session and waits until its process is gone. */
  readonly before: (userId: string, sessionId: string) => Promise<void>;
  /** Removes what the session left outside the database; called after every attempt, it must not throw. */
  readonly after: (sessionId: string) => Promise<void>;
}

/**
 * Rejects deactivated accounts and accounts that still have to change their password.
 *
 * @throws {ChatError} `accessDenied`.
 */
export function requireChatActor(actor: User): void {
  if (!actor.isActive || actor.mustChangePassword)
    throw new ChatError("accessDenied");
}

/** Validates an external session ID; it is never a path or SQL fragment. */
export function readChatSessionId(input: unknown): string {
  if (!isChatSessionId(input)) throw new ChatError("invalidInput");
  return input;
}

/** The word that confirms a deletion in the interface language, as for MCP (T6.4.46). */
export function chatConfirmationWord(
  language: string | undefined,
): ChatConfirmationWord {
  return language === "en" ? "DELETE" : "LÖSCHEN";
}

/** Strips storage details from an attachment. */
export function publicChatAttachment(
  attachment: StoredChatAttachment,
): ChatAttachment {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}

/** Validates one bounded, explicit selection; callers can submit larger selections in batches. */
export function readChatDeletionIds(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 200)
    throw new ChatError("invalidInput");
  const ids = input.map(readChatSessionId);
  if (new Set(ids).size !== ids.length) throw new ChatError("invalidInput");
  return ids;
}

/**
 * The personal sessions of the chat and the commands `/new`, `/sessions` and
 * `/delete` (T6.12.2, T6.12.3).
 *
 * @remarks
 * Every call is bound to the person's own sessions. An ID alone never opens a
 * session of someone else; administrators have no other read path.
 */
export class ChatSessionService {
  private readonly dependencies: ChatSessionDependencies;
  private readonly createId: () => string;
  private deletionEffects: ChatSessionDeletionEffects | null = null;

  public constructor(dependencies: ChatSessionDependencies) {
    this.dependencies = dependencies;
    this.createId = dependencies.createId ?? (() => createChatSessionId());
  }

  /**
   * Connects deletion to the jobs of the Codex path, which are built on this service.
   *
   * @param effects - Stops a running job before and cleans up after each deletion.
   */
  public setDeletionEffects(effects: ChatSessionDeletionEffects): void {
    this.deletionEffects = effects;
  }

  /** Opens the most recently used session, or a new one for a first visit. */
  public async open(actor: User): Promise<ChatOverview> {
    requireChatActor(actor);
    const [latest] = await this.dependencies.sessions.list(actor.id, 1);
    const session = latest ?? (await this.createSession(actor.id));
    const [view, settings, confirmationWord] = await Promise.all([
      this.viewOf(session, actor.id),
      this.dependencies.settings.read(),
      this.confirmationWord(actor.id),
    ]);
    return {
      ...view,
      attachmentLimitBytes: settings.attachmentLimitBytes,
      confirmationWord,
    };
  }

  /** Starts a new, empty session (`/new`). */
  public async create(actor: User): Promise<ChatSessionView> {
    requireChatActor(actor);
    return {
      session: await this.createSession(actor.id),
      messages: [],
      pending: [],
    };
  }

  /** Lists only the person's own sessions (`/sessions`). */
  public async list(actor: User): Promise<readonly ChatSession[]> {
    requireChatActor(actor);
    return this.dependencies.sessions.list(actor.id);
  }

  /** Switches to an own session. */
  public async view(actor: User, sessionId: unknown): Promise<ChatSessionView> {
    return this.viewOf(await this.require(actor, sessionId), actor.id);
  }

  /**
   * Deletes an own session for good, with its messages and attachments (`/delete`).
   *
   * @throws {ChatError} `confirmationRequired` unless the person typed the
   * confirmation word of the interface language; `sessionMissing` for a session
   * that is not the person's.
   */
  public async remove(
    actor: User,
    sessionId: unknown,
    confirmation: unknown,
  ): Promise<void> {
    requireChatActor(actor);
    const id = readChatSessionId(sessionId);
    if (confirmation !== (await this.confirmationWord(actor.id)))
      throw new ChatError("confirmationRequired");
    const files = await this.removeRows(actor.id, id);
    await this.dependencies.files.remove(files);
  }

  /**
   * Deletes the explicit UI selection after its button confirmation.
   * This entry point is wired only to the authenticated, same-origin chat route.
   * MCP must validate its own typed confirmation before calling this method.
   */
  public async removeSelected(
    actor: User,
    input: unknown,
  ): Promise<ChatDeletionResult> {
    requireChatActor(actor);
    const ids = readChatDeletionIds(input);
    // Preflight every target before the first mutation; foreign IDs never widen the selection.
    for (const id of ids) await this.require(actor, id);
    const deleted: string[] = [];
    const failed: { sessionId: string; error: string }[] = [];
    const cleanupFailed: string[] = [];
    for (const id of ids) {
      try {
        const files = await this.removeRows(actor.id, id);
        deleted.push(id);
        try {
          await this.dependencies.files.remove(files);
        } catch (caughtError: unknown) {
          logCaughtError("ChatSessionService", caughtError);

          cleanupFailed.push(id);
        }
      } catch (error: unknown) {
        logCaughtError("ChatSessionService", error);

        failed.push({
          sessionId: id,
          error: error instanceof ChatError ? error.code : "general",
        });
      }
    }
    return { deleted, failed, cleanupFailed };
  }

  /**
   * Returns an own session.
   *
   * @throws {ChatError} `sessionMissing` for an unknown or foreign session.
   */
  public async require(actor: User, sessionId: unknown): Promise<ChatSession> {
    requireChatActor(actor);
    const session = await this.dependencies.sessions.find(
      actor.id,
      readChatSessionId(sessionId),
    );
    if (session === null) throw new ChatError("sessionMissing");
    return session;
  }

  /** The word the person types to confirm a deletion, in their interface language. */
  public async confirmationWord(userId: string): Promise<ChatConfirmationWord> {
    const settings = await this.dependencies.languages.findByUserId(userId);
    return chatConfirmationWord(settings?.language);
  }

  /**
   * Deletes the rows of an own session; a running answer ends before, and its
   * leftovers outside the database are removed after, also when deleting failed.
   */
  private async removeRows(
    userId: string,
    sessionId: string,
  ): Promise<readonly string[]> {
    const effects = this.deletionEffects;
    try {
      await effects?.before(userId, sessionId);
      const files = await this.dependencies.sessions.remove(userId, sessionId);
      if (files === null) throw new ChatError("sessionMissing");
      return files;
    } finally {
      await effects?.after(sessionId);
    }
  }

  private async viewOf(
    session: ChatSession,
    userId: string,
  ): Promise<ChatSessionView> {
    const [messages, attachments, activity] = await Promise.all([
      this.dependencies.sessions.messages(session.id),
      this.dependencies.attachments.list(session.id),
      this.dependencies.activity?.(userId, session.id),
    ]);
    return {
      ...(activity ? { activity } : {}),
      session,
      messages: messages.map((message) => ({
        ...message,
        attachments: attachments
          .filter((attachment) => attachment.messageId === message.id)
          .map(publicChatAttachment),
      })),
      pending: attachments
        .filter((attachment) => attachment.messageId === null)
        .map(publicChatAttachment),
    };
  }

  private async createSession(userId: string): Promise<ChatSession> {
    const { sessions } = this.dependencies;
    for (let attempt = 0; attempt < ID_ATTEMPTS; attempt += 1) {
      const id = this.createId();
      if (await sessions.exists(id)) continue;
      await sessions.create(userId, id);
      const session = await sessions.find(userId, id);
      if (session !== null) return session;
    }
    throw new Error("No unused chat session ID was found.");
  }
}
