import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import { createAgentTaskContext } from "./AgentTaskAccess";
import { createAgentWikiAccess } from "./AgentWikiAccess";

import type { Database } from "@/backend/database/Database";
import type { WikiAccess, WikiViewer } from "@/backend/service/wiki/WikiAccess";
import type { User } from "@/definition/User";
import type { AgentTaskContext } from "./AgentTaskAccess";

/** Where an environment reads: the central database or the scope of one open transaction. */
export type StructuredImportScope = Pick<
  Database,
  "execute" | "query" | "transaction"
>;

/**
 * Everything one structured import call reads, bound to one database scope.
 *
 * @remarks
 * Account, rights and visibility are resolved when the environment is built,
 * on the scope it is built for, with the channel policy of MCP calls.
 */
export interface StructuredImportEnvironment {
  readonly actor: User;
  readonly projects: ProjectRepository;
  readonly wiki: WikiRepository;
  readonly access: WikiAccess;
  readonly viewer: WikiViewer;
  readonly tasks: AgentTaskContext;
  readonly imports: AgentImportRepository;
  readonly assets: AgentAssetRepository;
}

/**
 * Builds the environment of one call for a verified account.
 *
 * @param scope - The database, or the scope of the transaction the call runs in.
 * @param userId - The verified owner of the call.
 * @returns The services and repositories bound to the scope.
 * @throws {McpAuthorizationError} When the account is gone, inactive or must change its password.
 */
export async function createStructuredImportEnvironment(
  scope: StructuredImportScope,
  userId: string,
): Promise<StructuredImportEnvironment> {
  const actor = await new UserRepository(scope).findById(userId);
  if (!actor?.isActive || actor.mustChangePassword)
    throw new McpAuthorizationError("invalid_token", 401);
  const projects = new ProjectRepository(scope, "mcp");
  const access = createAgentWikiAccess(projects, actor);
  return {
    actor,
    projects,
    wiki: new WikiRepository(scope, "mcp"),
    access,
    viewer: await access.resolve(actor),
    tasks: createAgentTaskContext(scope, actor),
    imports: new AgentImportRepository(scope),
    assets: new AgentAssetRepository(scope),
  };
}
