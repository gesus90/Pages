import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { TicketFileStore } from "@/backend/storage/TicketFileStore";

import { translateAssetWriteError } from "./AgentAssetWriteErrors";
import { attachmentReturnTarget } from "./AgentAttachmentReturnTarget";
import { AgentAttachmentReturnService } from "./AgentAttachmentReturnService";
import { createAgentTaskContext } from "./AgentTaskAccess";

import type { AuthorizedAssetReturn } from "./AgentAttachmentReturnService";
import type { Database } from "@/backend/database/Database";
import type { UploadedFile } from "@/backend/service/WikiService";
import type { UploadLimitSource } from "@/backend/service/task/TaskAttachmentService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AgentAsset } from "@/definition/PagesAgentWrites";

/** Ticket-bound MCP uploads bypass staging and use the existing ticket access policy. */
export class AgentTicketUploadService {
  private readonly database: Database;
  private readonly directory: string;
  private readonly limits: UploadLimitSource;

  public constructor(
    database: Database,
    directory: string,
    limits: UploadLimitSource,
  ) {
    this.database = database;
    this.directory = directory;
    this.limits = limits;
  }

  /** Checks destination visibility and writability before a capability is minted. */
  public async authorize(
    identity: AgentIdentity,
    ticketId: string,
  ): Promise<void> {
    try {
      const { actor, attachments } = await this.context(identity);
      await attachments.authorizeUpload(actor, ticketId);
    } catch (error: unknown) {
      throw translateAssetWriteError(error);
    }
  }

  /** Returns a permanent attachment address with no expiry and no staged copy. */
  public async upload(
    file: UploadedFile,
    revalidate: () => Promise<AgentIdentity>,
    ticketId: string,
    request?: AuthorizedAssetReturn,
  ): Promise<AgentAsset> {
    try {
      if (request)
        return await new AgentAttachmentReturnService({
          database: this.database,
          directory: this.directory,
          limits: this.limits,
        }).upload(file, revalidate, ticketId, request);
      const identity = await revalidate();
      const { actor, attachments } = await this.context(identity);
      const attachment = await attachments.upload(
        actor,
        ticketId,
        file,
        async () => {
          const current = await revalidate();
          if (current.userId !== identity.userId)
            throw new AgentOperationError("FORBIDDEN");
          await this.context(current);
        },
      );
      return {
        assetId: attachment.id,
        link: `/aufgaben/attachments/${attachment.id}`,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        size: attachment.size,
        expiresAt: null,
      };
    } catch (error: unknown) {
      throw translateAssetWriteError(error);
    }
  }

  /** Authorizes an existing wiki destination through its own attachment access policy. */
  public async authorizeWiki(
    identity: AgentIdentity,
    pageId: string,
  ): Promise<void> {
    try {
      const { actor } = await this.context(identity);
      const target = attachmentReturnTarget({
        scope: this.database,
        actor,
        directory: this.directory,
        limits: this.limits,
        destination: { type: "wiki", id: pageId },
      });
      await target.authorize();
    } catch (error: unknown) {
      throw translateAssetWriteError(error);
    }
  }

  /** Returns a permanent wiki attachment with the same bounded replay and revision contract as tickets. */
  public async uploadWiki(
    file: UploadedFile,
    revalidate: () => Promise<AgentIdentity>,
    pageId: string,
    request: AuthorizedAssetReturn,
  ): Promise<AgentAsset> {
    try {
      return await new AgentAttachmentReturnService({
        database: this.database,
        directory: this.directory,
        limits: this.limits,
      }).upload(file, revalidate, { type: "wiki", id: pageId }, request);
    } catch (error: unknown) {
      throw translateAssetWriteError(error);
    }
  }

  private async context(identity: AgentIdentity): Promise<{
    readonly actor: NonNullable<
      Awaited<ReturnType<UserRepository["findById"]>>
    >;
    readonly attachments: TaskAttachmentService;
  }> {
    if (identity.run && identity.run.reach !== "full")
      throw new AgentOperationError("FORBIDDEN");
    if (!identity.isAdmin && !identity.permissions.includes("write"))
      throw new AgentOperationError("FORBIDDEN");
    const actor = await new UserRepository(this.database).findById(
      identity.userId,
    );
    if (!actor?.isActive || actor.mustChangePassword)
      throw new McpAuthorizationError("invalid_token", 401);
    const context = createAgentTaskContext(this.database, actor);
    return {
      actor,
      attachments: new TaskAttachmentService(
        new WorkItemAttachmentRepository(this.database),
        context.tasks,
        this.limits,
        new TicketFileStore(this.directory),
      ),
    };
  }
}
