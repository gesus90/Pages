import { loggedOperation } from "@/backend/logging/LoggedOperation";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { logCaughtError } from "@/backend/logging/Logger";

import { resolveAgentTicketReference } from "./agents/AgentTicketValidation";
import {
  PROJECT_NAMES_OPERATION,
  ownerOperations,
  sessionOperations,
} from "./mcp/AgentOperationCatalog";

import type { AgentTicketAssetService } from "./agents/AgentTicketAssetService";
import type { AgentAsset } from "@/definition/PagesAgentWrites";
import type { AgentAssetDownloadService } from "./agents/AgentAssetDownloadService";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { AgentOperationRouter } from "./agents/AgentOperationRouter";
import type {
  PagesAgentReadResponse,
  PagesAgentStructuredReadResponse,
} from "@/definition/PagesAgentOperations";
import type { AgentProjectService } from "./mcp/AgentProjectService";
import type { AgentRunCredentialService } from "./mcp/AgentRunCredentialService";
import type { PersonalAgentTokenService } from "./mcp/PersonalAgentTokenService";
import type {
  AgentIdentity,
  AgentRunScope,
} from "@/definition/McpAuthorization";
import type {
  PagesAgentApiProjectNames,
  PagesAgentApiVerification,
} from "@/definition/PagesAgentApi";

/** Operations that verify the credential again while they run, as an import does. */
const REVERIFIED_OPERATIONS: readonly unknown[] = [
  "wiki.import.apply",
  "wiki.import.update",
  "import.structured.apply",
];

/** Whether a ticket-bound session names one of its tickets, by the identifier or key it was given. */
function isRunTicketCall(scope: AgentRunScope, parameters: unknown): boolean {
  if (typeof parameters !== "object" || parameters === null) return false;
  const ticketId: unknown = Reflect.get(parameters, "ticketId");
  if (typeof ticketId !== "string") return false;
  const reference = resolveAgentTicketReference(ticketId);
  if (reference === null) return false;
  return scope.tickets.some((ticket) =>
    "id" in reference
      ? ticket.id === reference.id
      : ticket.key.toUpperCase() === reference.key,
  );
}

/** Verifies personal stdio credentials and dispatches the implemented operations. */
export class PagesAgentApiService {
  private readonly personal: PersonalAgentTokenService;
  private readonly projects: AgentProjectService;
  private readonly operations: AgentOperationRouter;
  private readonly runs: AgentRunCredentialService | null;
  private readonly downloads: AgentAssetDownloadService | null;
  private readonly publish:
    ((ticket: string, bytes: Buffer) => Promise<AgentAsset>) | undefined;

  public constructor(
    personal: PersonalAgentTokenService,
    projects: AgentProjectService,
    operations: AgentOperationRouter,
    capabilities:
      | {
          readonly runs?: AgentRunCredentialService;
          readonly downloads?: AgentAssetDownloadService;
          readonly upload?: (
            ticket: string,
            bytes: Buffer,
          ) => Promise<AgentAsset>;
        }
      | AgentRunCredentialService
      | null = null,
  ) {
    this.personal = personal;
    this.projects = projects;
    this.operations = operations;
    this.publish =
      capabilities && !("verify" in capabilities)
        ? capabilities.upload
        : undefined;
    this.runs =
      capabilities && "verify" in capabilities
        ? capabilities
        : (capabilities?.runs ?? null);
    this.downloads =
      capabilities && "verify" in capabilities
        ? null
        : (capabilities?.downloads ?? null);
  }

  /** Receives only the private runner binary channel; the upload capability revalidates its originating scope. */
  public async uploadAsset(ticket: string, bytes: Buffer): Promise<AgentAsset> {
    if (!this.publish) throw new AgentOperationError("FORBIDDEN");
    return this.publish(ticket, bytes);
  }

  /** Binary runner reads use the same one-use authority and live file policy as ordinary Agent tools. */
  public async downloadAsset(
    token: string,
    link: string,
    digest?: string,
  ): Promise<Awaited<ReturnType<AgentTicketAssetService["read"]>>> {
    const identity = await this.verify(token);
    if (
      identity.run &&
      !sessionOperations(identity.run, identity.isAdmin).includes(
        "assets.download.prepare",
      )
    )
      throw new AgentOperationError("FORBIDDEN");
    if (!this.downloads) throw new AgentOperationError("INVALID_REQUEST");
    const ticket = await this.downloads.prepare(identity, token, { link });
    if (digest !== undefined && ticket.digest !== digest)
      throw new AgentOperationError("CONFLICT");
    return this.downloads.consume(ticket.ticket);
  }

  /**
   * Resolves current rights from the presented credential on every API call.
   *
   * @remarks
   * A personal credential acts with the full rights of its owner. The
   * credential of an agent plan session acts with the rights of its executor,
   * narrowed to the operations and tickets of its node.
   */
  public async verify(token: string): Promise<AgentIdentity> {
    try {
      return await this.personal.verify(token);
    } catch (error: unknown) {
      logCaughtError("PagesAgentApiService", error);

      if (!(error instanceof McpAuthorizationError) || this.runs === null)
        throw error;
      const session = await this.runs.verify(token);
      if (session === null) throw error;
      return session;
    }
  }

  /**
   * Verifies the credential anew and runs one operation for exactly its owner.
   *
   * @remarks
   * Reading project names needs no capability: reading is always enabled within the
   * permitted scope, so every verified identity is offered it. The caller never supplies
   * an identity; unknown operations are invalid requests.
   */
  public async handle(
    token: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<
    | PagesAgentApiVerification
    | PagesAgentApiProjectNames
    | PagesAgentReadResponse
    | PagesAgentStructuredReadResponse
    | PagesAgentWriteResponse
    | { readonly token: string; readonly expiresAt: number | null }
    | { readonly revoked: true }
  > {
    const identity = await this.verify(token);
    return loggedOperation(
      "PagesAgentApiService",
      "integration.agent_api",
      async () => {
        if (identity.run)
          return this.handleSession(identity, identity.run, token, input);
        return this.handlePersonal(identity, token, input);
      },
    );
  }

  /** Serves a personal credential with the full current rights of its owner. */
  private async handlePersonal(
    identity: AgentIdentity,
    token: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<
    | PagesAgentApiVerification
    | PagesAgentApiProjectNames
    | PagesAgentReadResponse
    | PagesAgentStructuredReadResponse
    | PagesAgentWriteResponse
    | { readonly token: string; readonly expiresAt: number | null }
    | { readonly revoked: true }
  > {
    if (input.operation === "verify") {
      return {
        apiVersion: "1",
        identity,
        credential: await this.personal.credential(token),
        tools: ownerOperations(identity.isAdmin),
      };
    }
    if (input.operation === "credential.rotate")
      return this.personal.rotateCredential(token);
    if (input.operation === "credential.revoke")
      return this.personal.revokeCredential(token);
    if (input.operation === "assets.upload.prepare")
      return this.operations.prepareUpload(identity, token, input.parameters);
    if (input.operation === "assets.download.prepare")
      return this.prepareDownload(identity, token, input.parameters);
    return this.dispatch(identity, token, input);
  }

  /**
   * Serves a session credential: only the operations, and with the `tickets`
   * reach only the tickets, of its node.
   *
   * @remarks
   * The operations themselves still check the current rights of the executor,
   * so the scope can only narrow them. A refused operation fails here, also
   * when a client calls it directly instead of through a listed tool. A
   * session cannot rotate or revoke its credential. Only a full session may issue an upload capability; read-only and ticket-limited sessions cannot.
   */
  private async handleSession(
    identity: AgentIdentity,
    scope: AgentRunScope,
    token: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<
    | PagesAgentApiVerification
    | PagesAgentApiProjectNames
    | PagesAgentReadResponse
    | PagesAgentStructuredReadResponse
    | PagesAgentWriteResponse
  > {
    const { userId, isAdmin, permissions } = identity;
    const allowed = sessionOperations(scope, isAdmin);
    if (input.operation === "verify")
      return {
        apiVersion: "1",
        identity: { userId, isAdmin, permissions },
        credential: null,
        tools: allowed,
      };
    if (
      !allowed.some((operation) => operation === input.operation) ||
      (scope.reach === "tickets" && !isRunTicketCall(scope, input.parameters))
    )
      throw new AgentOperationError("FORBIDDEN");
    if (input.operation === "assets.upload.prepare")
      return this.operations.prepareUpload(identity, token, input.parameters);
    if (input.operation === "assets.download.prepare")
      return this.prepareDownload(identity, token, input.parameters);
    return this.dispatch(identity, token, input);
  }

  private async prepareDownload(
    identity: AgentIdentity,
    token: string,
    input: unknown,
  ): Promise<PagesAgentReadResponse> {
    if (!this.downloads) throw new AgentOperationError("INVALID_REQUEST");
    return {
      apiVersion: "1",
      result: await this.downloads.prepare(identity, token, input),
    };
  }

  /** Runs an operation the credential may call, with the executor's current rights. */
  private async dispatch(
    identity: AgentIdentity,
    token: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<
    | PagesAgentApiProjectNames
    | PagesAgentReadResponse
    | PagesAgentStructuredReadResponse
    | PagesAgentWriteResponse
  > {
    if (input.operation === PROJECT_NAMES_OPERATION)
      return this.projectNames(identity, input.parameters);
    if (REVERIFIED_OPERATIONS.includes(input.operation))
      return this.operations.handle(identity, input, () => this.verify(token));
    return this.operations.handle(identity, input);
  }

  private async projectNames(
    identity: AgentIdentity,
    input: unknown,
  ): Promise<PagesAgentApiProjectNames> {
    const parameters = input === undefined ? {} : input;
    if (
      typeof parameters !== "object" ||
      parameters === null ||
      Array.isArray(parameters) ||
      Object.keys(parameters).length > 0
    ) {
      throw new McpAuthorizationError("invalid_request");
    }
    return {
      apiVersion: "1",
      projectNames: await this.projects.listNames(identity.userId),
    };
  }
}
