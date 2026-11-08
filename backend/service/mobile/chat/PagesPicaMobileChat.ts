import { ChatError } from "@/backend/error/ChatErrors";

import { readCurrentSessionUser } from "../PicaMobileSessionUser";
import {
  toPicaMobileChatJob,
  toPicaMobileChatSessions,
  toPicaMobileChatView,
} from "./PicaMobileChatPayloads";

import type { AuthService } from "@/backend/auth/AuthService";
import type { ChatAttachmentService } from "@/backend/service/chat/ChatAttachmentService";
import type { ChatService } from "@/backend/service/chat/ChatService";
import type { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import type { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import type { PicaAdminService } from "@/backend/service/chat/admin/PicaAdminService";
import type { ChatSendResult } from "@/definition/Chat";
import type {
  PicaMobileChatAnswer,
  PicaMobileChatRequest,
} from "@/definition/PicaMobileProtocol";
import type { User } from "@/definition/User";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type {
  PicaMobileChatContext,
  PicaMobileChatFileOutcome,
  PicaMobileChatOutcome,
  PicaMobileChatProvider,
  PicaMobileChatUpload,
} from "./PicaMobileChatProvider";

/** The Pages services the chat of Pica Mobile is answered from. */
export interface PicaMobileChatServices {
  readonly authService: Pick<AuthService, "getAuthenticatedUser">;
  readonly chatSessionService: Pick<
    ChatSessionService,
    "open" | "create" | "list" | "view" | "state" | "require" | "removeSelected"
  >;
  readonly chatService: Pick<ChatService, "submit">;
  /** `null` while the ACP path of Pica is off; there is no job to read or stop then. */
  readonly picaAcpService: Pick<PicaAcpService, "update" | "stop"> | null;
  readonly chatAttachmentService: Pick<
    ChatAttachmentService,
    "upload" | "open" | "discard"
  >;
  readonly picaAdminService: Pick<PicaAdminService, "protectOrigin">;
}

type ChatRequestOf<Type extends PicaMobileChatRequest["type"]> = Extract<
  PicaMobileChatRequest,
  { readonly type: Type }
>;

/** The signed-in person with the origin of the connection. */
interface ChatActor {
  readonly user: User;
  readonly origin: string | null;
}

function answer(chatAnswer: PicaMobileChatAnswer): PicaMobileChatOutcome {
  return { kind: "answer", answer: chatAnswer };
}

function toSent(sent: ChatSendResult): PicaMobileChatOutcome {
  switch (sent.kind) {
    case "job":
      return answer({
        type: "chat_sent",
        payload: {
          kind: "job",
          messageId: sent.job.messageId,
          jobId: sent.job.job.id,
        },
      });
    case "steer":
      return answer({
        type: "chat_sent",
        payload: {
          kind: "steer",
          messageId: sent.steer.messageId,
          jobId: sent.steer.jobId,
          status: sent.steer.status,
        },
      });
    case "reply":
      // The production chat never answers directly; a reply and its one-time receipts never reach the app.
      return { kind: "unavailable" };
  }
}

/**
 * Answers `chat.v1` with the chat of Pages, in the same conversations as the web.
 *
 * @remarks
 * Every request reads the account behind the session first and then uses the
 * same services as the web chat, so rights, limits, the ACP path and the
 * repetition of a message with the same `clientMessageId` behave alike. A
 * {@link ChatError} becomes `chat_failed` with its code; one-time receipts
 * such as temporary passwords are never transferred. `chat_delete` of
 * `chat.delete` uses the deletion of the web chat.
 */
export class PagesPicaMobileChat implements PicaMobileChatProvider {
  /** Answers `chat_delete` with the deletion of the web chat. */
  public readonly canDelete = true;

  private readonly resolveServices: () => Promise<PicaMobileChatServices>;

  /**
   * Creates the provider.
   *
   * @param resolveServices - Resolves the Pages services when a request needs
   * them, so the listener works before the database does.
   */
  public constructor(resolveServices: () => Promise<PicaMobileChatServices>) {
    this.resolveServices = resolveServices;
  }

  /** Answers one chat request for the account behind the session. */
  public async answer(
    context: PicaMobileChatContext,
    request: PicaMobileChatRequest,
  ): Promise<PicaMobileChatOutcome> {
    const services = await this.resolveServices();
    const user = await readCurrentSessionUser(
      services.authService,
      context.session,
    );

    if (user === null) {
      return { kind: "sessionEnded" };
    }

    try {
      return await this.dispatch(
        services,
        { user, origin: context.origin },
        request,
      );
    } catch (error: unknown) {
      if (error instanceof ChatError) {
        return answer({ type: "chat_failed", payload: { code: error.code } });
      }

      throw error;
    }
  }

  /** Stores a file for the next message of an own session. */
  public async upload(
    session: PicaMobileSessionIdentity,
    upload: PicaMobileChatUpload,
  ): Promise<PicaMobileChatFileOutcome> {
    return this.transfer(session, async (services, user) => ({
      kind: "stored",
      attachment: await services.chatAttachmentService.upload(
        user,
        upload.sessionId,
        upload.file,
      ),
    }));
  }

  /** Opens an attachment of an own session for download. */
  public async download(
    session: PicaMobileSessionIdentity,
    attachmentId: string,
  ): Promise<PicaMobileChatFileOutcome> {
    return this.transfer(session, async (services, user) => ({
      kind: "opened",
      ...(await services.chatAttachmentService.open(user, attachmentId)),
    }));
  }

  /** Removes an unsent attachment of an own session. */
  public async discard(
    session: PicaMobileSessionIdentity,
    attachmentId: string,
  ): Promise<PicaMobileChatFileOutcome> {
    return this.transfer(session, async (services, user) => {
      await services.chatAttachmentService.discard(user, attachmentId);

      return { kind: "discarded" };
    });
  }

  private async transfer(
    session: PicaMobileSessionIdentity,
    work: (
      services: PicaMobileChatServices,
      user: User,
    ) => Promise<PicaMobileChatFileOutcome>,
  ): Promise<PicaMobileChatFileOutcome> {
    const services = await this.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);

    if (user === null) {
      return { kind: "sessionEnded" };
    }

    try {
      return await work(services, user);
    } catch (error: unknown) {
      if (error instanceof ChatError) {
        return { kind: "failed", code: error.code };
      }

      throw error;
    }
  }

  private async dispatch(
    services: PicaMobileChatServices,
    actor: ChatActor,
    request: PicaMobileChatRequest,
  ): Promise<PicaMobileChatOutcome> {
    const sessions = services.chatSessionService;
    const { user } = actor;

    switch (request.type) {
      case "chat_open":
        return this.view(toPicaMobileChatView(await sessions.open(user)));
      case "chat_new":
        return this.view(toPicaMobileChatView(await sessions.create(user)));
      case "chat_sessions":
        return answer({
          type: "chat_sessions",
          payload: toPicaMobileChatSessions(await sessions.list(user)),
        });
      case "chat_session_get":
        return this.view(
          toPicaMobileChatView(
            await sessions.view(user, request.payload.sessionId),
            request.payload.before,
          ),
        );
      case "chat_state":
        return answer({
          type: "chat_state",
          payload: await sessions.state(user, request.payload.sessionId),
        });
      case "chat_send":
        return this.send(services, actor, request);
      case "chat_job_get":
        return this.readJob(services, user, request);
      case "chat_stop":
        return this.stop(services, user, request);
      case "chat_delete":
        return this.remove(services, user, request);
    }
  }

  private view(
    payload: Extract<PicaMobileChatAnswer, { type: "chat_view" }>["payload"],
  ): PicaMobileChatOutcome {
    return answer({ type: "chat_view", payload });
  }

  private async send(
    services: PicaMobileChatServices,
    actor: ChatActor,
    request: ChatRequestOf<"chat_send">,
  ): Promise<PicaMobileChatOutcome> {
    const { clientMessageId, sessionId, text, attachmentIds } = request.payload;

    // The same protection as the web route: Pica's browser never reaches the host Pages answers on.
    if (actor.origin !== null) {
      services.picaAdminService.protectOrigin(actor.origin);
    }

    return toSent(
      await services.chatService.submit(actor.user, {
        requestId: clientMessageId,
        clientMessageId,
        sessionId,
        text,
        attachmentIds,
      }),
    );
  }

  private async readJob(
    services: PicaMobileChatServices,
    user: User,
    request: ChatRequestOf<"chat_job_get">,
  ): Promise<PicaMobileChatOutcome> {
    const { sessionId, jobId, after } = request.payload;
    const jobs = services.picaAcpService;

    if (jobs === null) {
      await services.chatSessionService.require(user, sessionId);
    }

    const update =
      jobs === null
        ? null
        : await jobs.update(user, { sessionId, jobId, after });

    return answer({ type: "chat_job", payload: toPicaMobileChatJob(update) });
  }

  private async stop(
    services: PicaMobileChatServices,
    user: User,
    request: ChatRequestOf<"chat_stop">,
  ): Promise<PicaMobileChatOutcome> {
    const { sessionId } = request.payload;

    await (services.picaAcpService === null
      ? services.chatSessionService.require(user, sessionId)
      : services.picaAcpService.stop(user, sessionId));

    return answer({ type: "chat_stopped", payload: { sessionId } });
  }

  /**
   * Deletes one own session with the deletion of the web chat.
   *
   * @remarks
   * `removeSelected` checks the session, stops a running answer, removes the
   * rows and files and logs as it does for the web. A session in `deleted`
   * no longer exists, even when only its file cleanup failed.
   */
  private async remove(
    services: PicaMobileChatServices,
    user: User,
    request: ChatRequestOf<"chat_delete">,
  ): Promise<PicaMobileChatOutcome> {
    const { sessionId } = request.payload;
    const deletion = await services.chatSessionService.removeSelected(user, [
      sessionId,
    ]);
    const failure = deletion.failed.find(
      (entry) => entry.sessionId === sessionId,
    );

    if (failure !== undefined) {
      return answer({ type: "chat_failed", payload: { code: failure.error } });
    }

    if (!deletion.deleted.includes(sessionId)) {
      return { kind: "unavailable" };
    }

    return answer({ type: "chat_deleted", payload: { sessionId } });
  }
}
