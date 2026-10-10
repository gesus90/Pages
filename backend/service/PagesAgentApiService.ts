import { PAGES_AGENT_READ_OPERATIONS } from "@/definition/PagesAgentOperations";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { AgentOperationRouter } from "./agents/AgentOperationRouter";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { AgentProjectService } from "./mcp/AgentProjectService";
import type { PersonalAgentTokenService } from "./mcp/PersonalAgentTokenService";
import type { OAuthTokenService } from "./mcp/OAuthTokenService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type {
  PagesAgentApiProjectNames,
  PagesAgentApiVerification,
} from "@/definition/PagesAgentApi";

/** Verifies stdio/API delegation credentials and dispatches the implemented operations. */
export class PagesAgentApiService {
  private readonly personal: PersonalAgentTokenService;
  private readonly oauth: OAuthTokenService;
  private readonly projects: AgentProjectService;
  private readonly operations: AgentOperationRouter;

  public constructor(
    personal: PersonalAgentTokenService,
    oauth: OAuthTokenService,
    projects: AgentProjectService,
    operations: AgentOperationRouter,
  ) {
    this.personal = personal;
    this.oauth = oauth;
    this.projects = projects;
    this.operations = operations;
  }

  /** Resolves current rights; OAuth access tokens are never accepted as API credentials. */
  public async verify(token: string): Promise<AgentIdentity> {
    try {
      return await this.personal.verify(token);
    } catch (error: unknown) {
      if (
        !(error instanceof McpAuthorizationError) ||
        error.code !== "invalid_token"
      )
        throw error;
    }
    try {
      return await this.oauth.verifyDelegation(token);
    } catch (error: unknown) {
      if (error instanceof McpAuthorizationError)
        throw new McpAuthorizationError("invalid_token", 401);
      throw error;
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
  > {
    const identity = await this.verify(token);
    if (input.operation === "verify") {
      return {
        apiVersion: "1",
        identity,
        tools: ["projects.names.list", ...PAGES_AGENT_READ_OPERATIONS],
      };
    }
    if (input.operation !== "projects.names.list") {
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
}
