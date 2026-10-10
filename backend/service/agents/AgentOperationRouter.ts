import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { ProjectAccessService } from "@/backend/service/project/ProjectAccessService";
import { WikiAccess } from "@/backend/service/wiki/WikiAccess";
import { WikiReadService } from "@/backend/service/wiki/WikiReadService";
import { WikiSearchService } from "@/backend/service/wiki/WikiSearchService";
import { WikiTrashService } from "@/backend/service/wiki/WikiTrashService";
import {
  PAGES_AGENT_LIMITS,
  PAGES_AGENT_READ_OPERATIONS,
} from "@/definition/PagesAgentOperations";

import { AgentProjectReadService } from "./AgentProjectReadService";
import { AgentWikiReadService } from "./AgentWikiReadService";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { UserService } from "@/backend/service/UserService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type {
  PagesAgentReadOperation,
  PagesAgentReadResponse,
} from "@/definition/PagesAgentOperations";

/** Server-owned dependencies; no actor or policy arrives through operation parameters. */
export interface AgentOperationDependencies {
  readonly projects: ProjectRepository;
  readonly wiki: WikiRepository;
  readonly users: Pick<UserService, "getById">;
}

function readParameters(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  return input as Record<string, unknown>;
}

function readText(
  parameters: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const text = parameters[name];
  if (
    typeof text !== "string" ||
    !text.trim() ||
    Array.from(text).length > PAGES_AGENT_LIMITS.textCharacters
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return text.trim();
}

function validateParameters(
  operation: PagesAgentReadOperation,
  parameters: Readonly<Record<string, unknown>>,
): void {
  const allowed = {
    "projects.resolve": ["name"],
    "projects.read": ["projectId"],
    "wiki.page.read": ["pageId"],
    "wiki.tree.read": ["projectId"],
    "wiki.search": ["text", "projectId"],
  }[operation];
  if (Object.keys(parameters).some((key) => !allowed.includes(key)))
    throw new AgentOperationError("INVALID_REQUEST");
}

/** Dispatches only A9.5 reads after fresh authentication, using isolated MCP policy and cache state. */
export class AgentOperationRouter {
  private readonly dependencies: AgentOperationDependencies;

  public constructor(dependencies: AgentOperationDependencies) {
    this.dependencies = dependencies;
  }

  /** Resolves current persisted scope for each call and returns a bounded version-1 result. */
  public async handle(
    identity: AgentIdentity,
    input: Readonly<Record<string, unknown>>,
  ): Promise<PagesAgentReadResponse> {
    const operation = PAGES_AGENT_READ_OPERATIONS.find(
      (name) => name === input.operation,
    );
    if (!operation) throw new AgentOperationError("INVALID_REQUEST");
    const parameters = readParameters(
      input.parameters === undefined ? {} : input.parameters,
    );
    validateParameters(operation, parameters);
    const actor = await this.dependencies.users.getById(identity.userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new McpAuthorizationError("invalid_token", 401);
    const access = new ProjectAccessService(
      this.dependencies.projects,
      ServerCache.disabled(),
      "mcp",
    );
    const projects = new AgentProjectReadService(access);
    const wikiAccess = new WikiAccess(
      {
        workItemVisibility: async (user) =>
          (await access.scope(user)).visibility,
      },
      new PermissionService((id) => access.account({ ...actor, id })),
    );
    const reads = new WikiReadService(
      this.dependencies.wiki,
      wikiAccess,
      new WikiTrashService(this.dependencies.wiki, wikiAccess),
    );
    const wiki = new AgentWikiReadService(
      reads,
      new WikiSearchService(this.dependencies.wiki, wikiAccess),
    );
    let result: PagesAgentReadResponse["result"];
    if (operation === "projects.resolve")
      result = await projects.resolve(actor, readText(parameters, "name"));
    else if (operation === "projects.read")
      result = await projects.read(actor, readText(parameters, "projectId"));
    else if (operation === "wiki.page.read")
      result = await wiki.read(actor, readText(parameters, "pageId"));
    else {
      const projectId =
        parameters.projectId === undefined
          ? undefined
          : readText(parameters, "projectId");
      if (projectId !== undefined) await projects.read(actor, projectId);
      result =
        operation === "wiki.tree.read"
          ? await wiki.tree(actor, projectId)
          : await wiki.search(actor, readText(parameters, "text"), projectId);
    }
    const response: PagesAgentReadResponse = { apiVersion: "1", result };
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      PAGES_AGENT_LIMITS.responseBytes
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE");
    return response;
  }
}
