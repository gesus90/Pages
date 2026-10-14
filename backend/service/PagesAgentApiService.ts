import { AGENT_EXTENSION_READ_OPERATIONS } from "@/definition/AgentExtensions";
import { AGENT_ADMIN_READ_OPERATIONS } from "@/definition/AgentAdministration";
import { AGENT_WORKSPACE_READ_OPERATIONS } from "@/definition/AgentWorkspaceOperations";
import { PAGE_AGENT_READ_OPERATIONS } from "@/definition/PageAgentOperations";
import { PAGES_AGENT_WRITE_OPERATIONS } from "@/definition/PagesAgentWrites";
import {
  PAGES_AGENT_COMMENT_OPERATIONS,
  PAGES_AGENT_READ_OPERATIONS,
  PAGES_AGENT_STRUCTURED_READ_OPERATIONS,
  PAGES_AGENT_TICKET_READ_OPERATIONS,
} from "@/definition/PagesAgentOperations";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import { resolveAgentTicketReference } from "./agents/AgentTicketValidation";

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

/** Whether a session may name this ticket: by the identifier or key it was given. */
function isRunTicket(scope: AgentRunScope, ticketId: unknown): boolean {
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

  public constructor(
    personal: PersonalAgentTokenService,
    projects: AgentProjectService,
    operations: AgentOperationRouter,
    runs: AgentRunCredentialService | null = null,
  ) {
    this.personal = personal;
    this.projects = projects;
    this.operations = operations;
    this.runs = runs;
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
    if (identity.run) return this.handleSession(identity, identity.run, input);
    return this.handlePersonal(identity, token, input);
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
        tools: [
          "projects.names.list",
          ...PAGES_AGENT_READ_OPERATIONS,
          ...PAGES_AGENT_TICKET_READ_OPERATIONS,
          ...PAGES_AGENT_STRUCTURED_READ_OPERATIONS,
          ...PAGES_AGENT_COMMENT_OPERATIONS,
          ...AGENT_EXTENSION_READ_OPERATIONS,
          ...AGENT_WORKSPACE_READ_OPERATIONS,
          ...PAGE_AGENT_READ_OPERATIONS,
          ...PAGES_AGENT_WRITE_OPERATIONS.filter(
            (operation) => identity.isAdmin || !operation.startsWith("admin."),
          ),
          ...(identity.isAdmin ? AGENT_ADMIN_READ_OPERATIONS : []),
        ],
      };
    }
    if (input.operation === "credential.rotate")
      return this.personal.rotateCredential(token);
    if (input.operation === "credential.revoke")
      return this.personal.revokeCredential(token);
    if (input.operation === "assets.upload.prepare")
      return this.operations.prepareUpload(identity, token, input.parameters);
    if (input.operation !== "projects.names.list") {
      if (
        input.operation === "wiki.import.apply" ||
        input.operation === "wiki.import.update" ||
        input.operation === "import.structured.apply"
      )
        return this.operations.handle(identity, input, () =>
          this.verify(token),
        );
      return this.operations.handle(identity, input);
    }
    const parameters = input.parameters === undefined ? {} : input.parameters;
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

  /**
   * Serves a session credential: only the operations and tickets of its node.
   *
   * @remarks
   * The operations themselves still check the current rights of the executor,
   * so the scope can only narrow them. A session cannot rotate or revoke its
   * credential and cannot upload files.
   */
  private async handleSession(
    identity: AgentIdentity,
    scope: AgentRunScope,
    input: Readonly<Record<string, unknown>>,
  ): Promise<
    | PagesAgentApiVerification
    | PagesAgentReadResponse
    | PagesAgentStructuredReadResponse
    | PagesAgentWriteResponse
  > {
    const { userId, isAdmin, permissions } = identity;
    if (input.operation === "verify")
      return {
        apiVersion: "1",
        identity: { userId, isAdmin, permissions },
        credential: null,
        tools: [
          ...PAGES_AGENT_TICKET_READ_OPERATIONS,
          ...PAGES_AGENT_WRITE_OPERATIONS,
        ].filter((operation) => scope.operations.includes(operation)),
      };
    const parameters = input.parameters;
    if (
      typeof input.operation !== "string" ||
      !scope.operations.includes(input.operation) ||
      typeof parameters !== "object" ||
      parameters === null ||
      !isRunTicket(scope, Reflect.get(parameters, "ticketId"))
    )
      throw new AgentOperationError("FORBIDDEN");
    return this.operations.handle(identity, input);
  }
}
