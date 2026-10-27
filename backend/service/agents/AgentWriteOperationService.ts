import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import { readAssetUploadInput } from "./AgentAssetReturnInput";
import { readAgentWikiCreate } from "./AgentWikiCreateValidation";

import type { AgentTicketUploadService } from "./AgentTicketUploadService";
import type { AgentUploadTicketService } from "./AgentUploadTicketService";
import type { AgentAssetService } from "./AgentAssetService";
import type { AgentWikiCreateService } from "./AgentWikiCreateService";
import type { UserService } from "@/backend/service/UserService";
import type { WikiService } from "@/backend/service/WikiService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";

/** Server-owned dependencies for the two A9.6 operations. */
export interface AgentWriteDependencies {
  readonly users: Pick<UserService, "getById">;
  readonly tickets: AgentUploadTicketService;
  readonly assets: AgentAssetService;
  readonly ticketUploads?: AgentTicketUploadService;
  readonly create: AgentWikiCreateService;
  readonly wiki: Pick<WikiService, "getSettings">;
}

function parameters(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  return input as Record<string, unknown>;
}

/** Dispatches uploads and page creation after fresh authentication; all actors remain server-owned. */
export class AgentWriteOperationService {
  private readonly dependencies: AgentWriteDependencies;

  public constructor(dependencies: AgentWriteDependencies) {
    this.dependencies = dependencies;
  }

  /** Mints an owner-bound capability using only authenticated metadata, never JSON file bytes. */
  public async prepare(
    identity: AgentIdentity,
    token: string,
    input: unknown,
  ): Promise<PagesAgentWriteResponse> {
    if (identity.run && identity.run.reach !== "full")
      throw new AgentOperationError("FORBIDDEN");
    if (!identity.isAdmin && !identity.permissions.includes("write"))
      throw new AgentOperationError("FORBIDDEN");
    const {
      fileName: requestedName,
      ticketId,
      pageId,
      request: returnRequest,
    } = readAssetUploadInput(input);
    const fileName = this.dependencies.assets.validateFileName(requestedName);
    await this.authorizeDestination(identity, { ticketId, pageId });
    const limits = await this.dependencies.wiki.getSettings();
    return {
      apiVersion: "1",
      result: {
        ...this.dependencies.tickets.issue(
          token,
          identity.userId,
          fileName,
          returnRequest
            ? { ticketId, pageId, request: returnRequest }
            : ticketId,
        ),
        header: "X-Pages-Upload-Ticket",
        uploadPath: "/api/v1/agent-assets",
        mediaLimitBytes: limits.mediaLimitBytes,
        fileLimitBytes: limits.fileLimitBytes,
      },
    };
  }

  /** Loads a fresh account before entering the atomically authorized create. */
  public async create(
    identity: AgentIdentity,
    input: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const request = readAgentWikiCreate(parameters(input));
    const actor = await this.dependencies.users.getById(identity.userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new McpAuthorizationError("invalid_token", 401);
    return {
      apiVersion: "1",
      result: await this.dependencies.create.create(actor, request),
    };
  }
  private async authorizeDestination(
    identity: AgentIdentity,
    destination: { readonly ticketId?: string; readonly pageId?: string },
  ): Promise<void> {
    if (!destination.ticketId && !destination.pageId) return;
    const service = this.dependencies.ticketUploads;
    if (!service) throw new AgentOperationError("INVALID_REQUEST");
    if (destination.ticketId)
      await service.authorize(identity, destination.ticketId);
    if (destination.pageId)
      await service.authorizeWiki(identity, destination.pageId);
  }
}
