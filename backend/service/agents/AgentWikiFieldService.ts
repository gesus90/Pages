import { createHash } from "node:crypto";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  WikiAccessDeniedError,
  WikiConflictError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { WikiMoveService } from "@/backend/service/wiki/WikiMoveService";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { WikiPageService } from "@/backend/service/wiki/WikiPageService";
import { WIKI_SCOPE } from "@/definition/Wiki";

import { agentTransactionScope } from "./AgentTransactionScope";
import { createAgentWikiAccess } from "./AgentWikiAccess";
import {
  isAgentWikiFieldOperation,
  readAgentWikiFieldChange,
  readAgentWikiMove,
} from "./AgentWikiFieldValidation";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { WikiPageRecord } from "@/backend/database/repositories/WikiRepository";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { WikiAccess, WikiViewer } from "@/backend/service/wiki/WikiAccess";
import type {
  AgentWikiFieldInput,
  AgentWikiMoveInput,
  AgentWikiPageChanged,
  AgentWikiPageMoved,
  AgentWikiPageOperation,
} from "@/definition/AgentWikiFields";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { User } from "@/definition/User";

/** The server-owned collaborators; pages change on the shared connection. */
export interface AgentWikiFieldDependencies {
  readonly database: Database;
  readonly events: PagesEventPublisher;
}

/** What one call changes for the person: the stored result and the page to announce, if any. */
interface FieldOutcome {
  readonly result: AgentWikiPageChanged | AgentWikiPageMoved;
  readonly changedPageId: string | null;
}

/** Account, policy and persistence of one call, all bound to its transaction. */
interface FieldContext {
  readonly actor: User;
  readonly wiki: WikiRepository;
  readonly access: WikiAccess;
  readonly viewer: WikiViewer;
  readonly reader: WikiPageReader;
}

/** Where a page stands among its siblings. */
interface PagePlace {
  readonly parentId: string | null;
  readonly projectId: string | null;
  readonly index: number;
}

/** Binds an operation ID to the exact page, revision and value it was first used with. */
function fingerprint(input: AgentWikiFieldInput | AgentWikiMoveInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** Business failures of the wiki become the fixed codes of the agent API. */
function translate(error: unknown): unknown {
  if (error instanceof WikiPageNotFoundError)
    return new AgentOperationError("NOT_FOUND");
  if (error instanceof WikiValidationError)
    return new AgentOperationError("INVALID_REQUEST");
  if (error instanceof WikiAccessDeniedError)
    return new AgentOperationError("FORBIDDEN");
  if (error instanceof WikiConflictError)
    return new AgentOperationError("CONFLICT");
  return error;
}

async function placeOf(
  context: FieldContext,
  page: WikiPageRecord,
): Promise<PagePlace> {
  const siblings = await context.wiki.writes.findSiblingIds(page, page.ownerId);
  return {
    parentId: page.parentId,
    projectId: page.projectId,
    index: siblings.indexOf(page.id),
  };
}

/** Changes one field or the place of a page for an agent, atomically and without touching the rest. */
export class AgentWikiFieldService {
  private readonly dependencies: AgentWikiFieldDependencies;

  public constructor(dependencies: AgentWikiFieldDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Runs one granular page operation for the owner of a verified credential.
   *
   * @param identity - The verified owner of the operation.
   * @param operation - `wiki.page.setTitle`, `wiki.page.setContent`, `wiki.page.setIcon` or `wiki.page.move`.
   * @param parameters - The raw operation parameters.
   * @returns The stored result; a repeated operation ID returns it unchanged.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND` or `CONFLICT`.
   *
   * @remarks
   * Rights and visibility are resolved anew inside the transaction. The order is fixed so
   * that a hidden page is indistinguishable from a missing one: write right, then
   * visibility, then the revision. A refused call writes nothing and stores no result.
   */
  public async apply(
    identity: AgentIdentity,
    operation: AgentWikiPageOperation,
    parameters: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const request = isAgentWikiFieldOperation(operation)
      ? readAgentWikiFieldChange(operation, parameters)
      : readAgentWikiMove(parameters);
    let outcome: FieldOutcome;
    try {
      outcome = await this.dependencies.database.transaction((transaction) =>
        this.run(transaction, identity.userId, operation, request),
      );
    } catch (error: unknown) {
      throw translate(error);
    }
    if (outcome.changedPageId !== null)
      this.dependencies.events.publish({
        type: "wiki.page.updated",
        id: outcome.changedPageId,
      });
    return { apiVersion: "1", result: outcome.result };
  }

  private async run(
    transaction: DatabaseTransaction,
    userId: string,
    operation: AgentWikiPageOperation,
    request: AgentWikiFieldInput | AgentWikiMoveInput,
  ): Promise<FieldOutcome> {
    const scope = agentTransactionScope(transaction);
    const actor = await new UserRepository(scope).findById(userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new McpAuthorizationError("invalid_token", 401);
    const access = createAgentWikiAccess(new ProjectRepository(scope), actor);
    const viewer = await access.resolve(actor);
    if (!viewer.canWrite) throw new AgentOperationError("FORBIDDEN");
    const wiki = new WikiRepository(scope);
    const context = {
      actor,
      wiki,
      access,
      viewer,
      reader: new WikiPageReader(wiki),
    };
    const operations = new AgentOperationKeyRepository(transaction);
    const hash = fingerprint(request);
    const previous = await operations.find(userId, request.operationId);
    if (previous) {
      if (previous.operation !== operation || previous.fingerprint !== hash)
        throw new AgentOperationError("CONFLICT");
      // This JSON is written only below, with the public result schema, in the same commit.
      const stored = JSON.parse(previous.resultJson) as FieldOutcome["result"];
      // A stored identifier is shown again only while the page is still visible.
      await context.reader.require(viewer.scope, stored.pageId);
      return { result: stored, changedPageId: null };
    }
    const page = await context.reader.require(viewer.scope, request.pageId);
    if (page.revision !== request.expectedRevision)
      throw new AgentOperationError("CONFLICT");
    const outcome =
      "field" in request
        ? await this.setField(context, page, request)
        : await this.move(context, page, request);
    await operations.insert(userId, request.operationId, {
      operation,
      fingerprint: hash,
      resultJson: JSON.stringify(outcome.result),
    });
    return outcome;
  }

  /** Reads the current values and hands them back unchanged, except the one the call names. */
  private async setField(
    context: FieldContext,
    page: WikiPageRecord,
    request: AgentWikiFieldInput,
  ): Promise<FieldOutcome> {
    // Every save keeps the previous state as its own version, also within ten minutes of an
    // earlier save by the same account.
    const written = await new WikiPageService(
      context.wiki,
      context.access,
    ).update(context.actor, page.id, {
      title: request.field === "title" ? request.value : page.title,
      content: request.field === "content" ? request.value : page.content,
      icon: request.field === "icon" ? request.value : page.icon,
      expectedRevision: page.revision,
      coalesceVersions: false,
    });
    const hasChanged = written.revision !== page.revision;
    return {
      result: {
        pageId: page.id,
        link: `/wiki/${page.id}`,
        field: request.field,
        revision: written.revision,
        changed: hasChanged,
      },
      changedPageId: hasChanged ? page.id : null,
    };
  }

  /** Moves a project page to an explicit visible place of a project, with its subtree. */
  private async move(
    context: FieldContext,
    page: WikiPageRecord,
    request: AgentWikiMoveInput,
  ): Promise<FieldOutcome> {
    if (page.scope !== WIKI_SCOPE.PROJECT)
      throw new AgentOperationError("INVALID_REQUEST");
    await this.requireTarget(context, request);
    const placement = {
      parentId: request.parentId,
      scope: WIKI_SCOPE.PROJECT,
      projectId: request.projectId,
      beforeId: request.beforeId,
    };
    const moves = new WikiMoveService(context.wiki, context.access);
    // The preview runs the same target checks as the move and tells who will see the page.
    const visibility = await moves.preview(context.actor, page.id, placement);
    const before = await placeOf(context, page);
    await moves.move(context.actor, page.id, placement);
    const moved = await context.reader.require(context.viewer.scope, page.id);
    const after = await placeOf(context, moved);
    const hasChanged =
      before.parentId !== after.parentId ||
      before.projectId !== after.projectId ||
      before.index !== after.index;
    return {
      result: {
        pageId: page.id,
        link: `/wiki/${page.id}`,
        field: "location",
        revision: moved.revision,
        changed: hasChanged,
        parentId: moved.parentId,
        projectId: request.projectId,
        visibility,
      },
      changedPageId: hasChanged ? page.id : null,
    };
  }

  /** The project, the parent and the sibling must all be visible and belong together. */
  private async requireTarget(
    context: FieldContext,
    request: AgentWikiMoveInput,
  ): Promise<void> {
    const { reader, viewer } = context;
    if (!viewer.scope.projectIds.includes(request.projectId))
      throw new AgentOperationError("NOT_FOUND");
    if (request.parentId !== null) {
      const parent = await reader.require(viewer.scope, request.parentId);
      if (
        parent.scope !== WIKI_SCOPE.PROJECT ||
        parent.projectId !== request.projectId
      )
        throw new AgentOperationError("NOT_FOUND");
    }
    // A sibling that is not visible is reported like a missing one.
    if (request.beforeId !== null)
      await reader.require(viewer.scope, request.beforeId);
  }
}
