import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { WIKI_SCOPE } from "@/definition/Wiki";

import { agentTransactionScope } from "./AgentTransactionScope";
import { createAgentWikiAccess } from "./AgentWikiAccess";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { WikiAccess, WikiViewer } from "@/backend/service/wiki/WikiAccess";
import type { AgentImportPlan } from "@/definition/AgentImportManifest";
import type { User } from "@/definition/User";
import type { WikiImportTargetState } from "./WikiImportFingerprint";

/** Transaction-local identity and visibility; no cached or client-owned authority. */
export interface WikiImportContext {
  readonly actor: User;
  readonly projectId: string;
  readonly wiki: WikiRepository;
  readonly access: WikiAccess;
  readonly viewer: WikiViewer;
}

/** Accepted plan and existing ancestor revisions, retained while its sources commit separately. */
export interface WikiImportSnapshot {
  readonly plan: AgentImportPlan;
  readonly parents: WikiImportTargetState["parents"];
}

/** Resolves current account and project policy on the source's transaction connection. */
export async function resolveWikiImportContext(
  transaction: DatabaseTransaction,
  userId: string,
  projectId: string,
): Promise<WikiImportContext> {
  const scope = agentTransactionScope(transaction);
  const actor = await new UserRepository(scope).findById(userId);
  if (!actor?.isActive || actor.mustChangePassword)
    throw new McpAuthorizationError("invalid_token", 401);
  const access = createAgentWikiAccess(new ProjectRepository(scope), actor);
  const viewer = await access.resolve(actor);
  if (!viewer.scope.projectIds.includes(projectId))
    throw new AgentOperationError("NOT_FOUND");
  return { actor, projectId, wiki: new WikiRepository(scope), access, viewer };
}

/** Reads the selected existing parent chain without visits, rejecting foreign scopes and templates. */
export async function readWikiImportParents(
  context: WikiImportContext,
  parentId: string | null,
): Promise<WikiImportTargetState["parents"]> {
  const parents: WikiImportTargetState["parents"][number][] = [];
  const reader = new WikiPageReader(context.wiki);
  let currentId = parentId;
  while (currentId !== null) {
    const page = await reader.require(context.viewer.scope, currentId);
    if (
      page.projectId !== context.projectId ||
      page.scope !== WIKI_SCOPE.PROJECT
    )
      throw new AgentOperationError("NOT_FOUND");
    if (currentId === parentId && page.isTemplate)
      throw new AgentOperationError("INVALID_REQUEST");
    parents.push({
      id: page.id,
      revision: page.revision,
      parentId: page.parentId,
    });
    currentId = page.parentId;
  }
  return parents;
}

/** Checks result visibility again before persisted page identifiers can leave the server. */
export async function requireWikiImportPage(
  context: WikiImportContext,
  pageId: string,
): Promise<void> {
  const page = await new WikiPageReader(context.wiki).require(
    context.viewer.scope,
    pageId,
  );
  if (page.projectId !== context.projectId || page.scope !== WIKI_SCOPE.PROJECT)
    throw new AgentOperationError("NOT_FOUND");
}
