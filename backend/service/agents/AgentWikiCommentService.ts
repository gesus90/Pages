import { createHash } from "node:crypto";

import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { WikiCommentService } from "@/backend/service/wiki/WikiCommentService";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
import { logCaughtError } from "@/backend/logging/Logger";

import { requireAgentConfirmation } from "./AgentConfirmation";
import { pageAgentEntries } from "./AgentCursor";
import { readParameterRecord } from "./AgentParameterReader";
import { agentTransactionScope } from "./AgentTransactionScope";
import { createAgentWikiAccess } from "./AgentWikiAccess";
import {
  readAgentWikiCommentsRead,
  readAgentWikiCommentWrite,
} from "./AgentWikiCommentValidation";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { StoredWikiComment } from "@/backend/database/repositories/WikiRepository";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { WikiAccess, WikiViewer } from "@/backend/service/wiki/WikiAccess";
import type {
  AgentWikiComment,
  AgentWikiCommentAdded,
  AgentWikiCommentChanged,
  AgentWikiCommentWriteOperation,
} from "@/definition/AgentWikiComments";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { User } from "@/definition/User";
import type { WikiComment } from "@/definition/Wiki";
import type { AgentWikiCommentRequest } from "./AgentWikiCommentValidation";

/** The server-owned collaborators; comments change on the shared connection. */
export interface AgentWikiCommentDependencies {
  readonly database: Database;
  readonly events: PagesEventPublisher;
  /** The agent surface the comments run for; MCP when absent. */
  readonly channel?: AgentChannel;
}

/** What one call changed: the stored result and the page whose comments to announce, if any. */
interface CommentOutcome {
  readonly result: AgentWikiCommentAdded | AgentWikiCommentChanged;
  readonly changedPageId: string | null;
}

/** Account, policy and persistence of one call. */
interface CommentContext {
  readonly actor: User;
  readonly wiki: WikiRepository;
  readonly access: WikiAccess;
  readonly comments: WikiCommentService;
}

/** A write call also needs to see which pages the account reads. */
interface CommentWriteContext extends CommentContext {
  readonly viewer: WikiViewer;
  readonly reader: WikiPageReader;
}

type CommentScope = Pick<Database, "execute" | "query" | "transaction">;

/** Binds an operation ID to the exact request it was first used with. */
function fingerprint(request: AgentWikiCommentRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

/** Business failures of the wiki become the fixed codes of the agent API. */
function translate(error: unknown): unknown {
  if (error instanceof WikiPageNotFoundError)
    return new AgentOperationError("NOT_FOUND");
  if (error instanceof WikiValidationError)
    return new AgentOperationError("INVALID_REQUEST");
  if (error instanceof WikiAccessDeniedError)
    return new AgentOperationError("FORBIDDEN");
  return error;
}

function pageLink(pageId: string): string {
  return `/wiki/${pageId}`;
}

async function openContext(
  scope: CommentScope,
  userId: string,
  channel: AgentChannel,
): Promise<CommentContext> {
  const actor = await new UserRepository(scope).findById(userId);
  if (!actor?.isActive || actor.mustChangePassword)
    throw new McpAuthorizationError("invalid_token", 401);
  const wiki = new WikiRepository(scope, agentChannelPolicy(channel).source);
  // The access context of the channel decides who is an administrator, like every other agent operation.
  const access = createAgentWikiAccess(
    new ProjectRepository(scope),
    actor,
    channel,
  );
  return {
    actor,
    wiki,
    access,
    comments: new WikiCommentService(wiki, access),
  };
}

function describeComment(
  comment: WikiComment,
  parentId: string | null,
): AgentWikiComment {
  return {
    id: comment.id,
    parentId,
    authorName: comment.authorName,
    body: comment.body,
    quote: comment.quote,
    isStale: comment.isStale,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    isResolved: comment.resolvedAt !== null,
    resolvedAt: comment.resolvedAt,
    resolvedByName: comment.resolvedByName,
    canEdit: comment.canEdit,
    canDelete: comment.canChange,
  };
}

/** Reads, writes, answers, resolves and deletes the comments of wiki pages for an agent. */
export class AgentWikiCommentService {
  private readonly dependencies: AgentWikiCommentDependencies;

  public constructor(dependencies: AgentWikiCommentDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the comments of one visible page as threads.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - The raw operation parameters: `pageId` as identifier or address.
   * @returns The threads, oldest first, each with its replies.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND` or `PAYLOAD_TOO_LARGE`.
   *
   * @remarks
   * A page the account cannot see is reported like a missing one. Reading needs no
   * capability beyond seeing the page.
   */
  public async read(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const fields = readParameterRecord(parameters);
    if (
      Object.keys(fields).some(
        (key) => !["pageId", "cursor", "limit"].includes(key),
      )
    )
      throw new AgentOperationError("INVALID_REQUEST");
    const pageId = readAgentWikiCommentsRead({ pageId: fields.pageId });
    const context = await openContext(
      this.dependencies.database,
      identity.userId,
      this.dependencies.channel ?? "mcp",
    );
    let threads: Awaited<ReturnType<WikiCommentService["list"]>>;
    try {
      threads = await context.comments.list(context.actor, pageId);
    } catch (error: unknown) {
      logCaughtError("AgentWikiCommentService", error);

      throw translate(error);
    }
    const paged = pageAgentEntries(
      threads.map((thread) => ({ id: thread.comment.id, thread })),
      {
        cursor: fields.cursor,
        limit: fields.limit,
        preserveOrder: true,
        context: JSON.stringify([
          identity.userId,
          "wiki.comments.read",
          pageId,
        ]),
      },
    );
    const response: PagesAgentReadResponse = {
      apiVersion: "1",
      result: {
        pageId,
        link: pageLink(pageId),
        total: paged.total,
        nextCursor: paged.nextCursor,
        threads: paged.entries.map(({ thread }) => ({
          comment: describeComment(thread.comment, null),
          replies: thread.replies.map((reply) =>
            describeComment(reply, thread.comment.id),
          ),
        })),
      },
    };
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      PAGES_AGENT_LIMITS.responseBytes
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE");
    return response;
  }

  /**
   * Runs one comment write for the owner of a verified credential.
   *
   * @param identity - The verified owner of the operation.
   * @param operation - `wiki.comment.add`, `wiki.comment.edit`, `wiki.comment.resolve` or `wiki.comment.delete`.
   * @param parameters - The raw operation parameters.
   * @returns The stored result; a repeated operation ID returns it unchanged.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND` or `CONFLICT`.
   *
   * @remarks
   * Rights and visibility are resolved anew inside the transaction. Commenting, answering
   * and resolving need only the right to see the page; changing a text belongs to its
   * author and deleting to the author, the owner of the page and administrators, exactly
   * as in the wiki. A comment on a hidden page is reported like a missing one. A refused
   * call writes nothing and stores no result.
   */
  public async apply(
    identity: AgentIdentity,
    operation: AgentWikiCommentWriteOperation,
    parameters: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const request = readAgentWikiCommentWrite(operation, parameters);
    let outcome: CommentOutcome;
    try {
      outcome = await this.dependencies.database.transaction((transaction) =>
        this.run(transaction, identity.userId, request),
      );
    } catch (error: unknown) {
      logCaughtError("AgentWikiCommentService", error);

      throw translate(error);
    }
    if (outcome.changedPageId !== null)
      this.dependencies.events.publish({
        type: "wiki.comments.changed",
        id: outcome.changedPageId,
      });
    return { apiVersion: "1", result: outcome.result };
  }

  private async run(
    transaction: DatabaseTransaction,
    userId: string,
    request: AgentWikiCommentRequest,
  ): Promise<CommentOutcome> {
    if (request.operation === "wiki.comment.delete")
      await requireAgentConfirmation(transaction, userId, request.confirmation);
    const base = await openContext(
      agentTransactionScope(transaction),
      userId,
      this.dependencies.channel ?? "mcp",
    );
    const viewer = await base.access.resolve(base.actor);
    const context = {
      ...base,
      viewer,
      reader: new WikiPageReader(base.wiki),
    };
    const operations = new AgentOperationKeyRepository(transaction);
    const hash = fingerprint(request);
    const previous = await operations.find(userId, request.operationId);
    if (previous) {
      if (
        previous.operation !== request.operation ||
        previous.fingerprint !== hash
      )
        throw new AgentOperationError("CONFLICT");
      // This JSON is written only below, with the public result schema, in the same commit.
      const stored = JSON.parse(
        previous.resultJson,
      ) as CommentOutcome["result"];
      // A stored identifier is shown again only while the page is still visible.
      await context.reader.require(viewer.scope, stored.pageId);
      return { result: stored, changedPageId: null };
    }
    const outcome = await this.change(context, request);
    await operations.insert(userId, request.operationId, {
      operation: request.operation,
      fingerprint: hash,
      resultJson: JSON.stringify(outcome.result),
    });
    return outcome;
  }

  private async change(
    context: CommentWriteContext,
    request: AgentWikiCommentRequest,
  ): Promise<CommentOutcome> {
    switch (request.operation) {
      case "wiki.comment.add":
        return this.add(context, request);
      case "wiki.comment.edit":
        return this.edit(context, request.commentId, request.body);
      case "wiki.comment.resolve":
        return this.resolve(context, request.commentId, request.resolved);
      case "wiki.comment.delete":
        return this.remove(context, request.commentId);
    }
  }

  /** The wiki service checks that the page is visible and that a parent is a first comment of it. */
  private async add(
    context: CommentWriteContext,
    request: Extract<
      AgentWikiCommentRequest,
      { operation: "wiki.comment.add" }
    >,
  ): Promise<CommentOutcome> {
    const comment = await context.comments.add(context.actor, request.pageId, {
      body: request.body,
      parentId: request.parentId,
      quote: request.quote,
      quotePrefix: null,
      quoteSuffix: null,
    });
    return {
      result: {
        commentId: comment.id,
        pageId: comment.pageId,
        link: pageLink(comment.pageId),
        parentId: request.parentId,
        isStale: comment.isStale,
      },
      changedPageId: comment.pageId,
    };
  }

  private async edit(
    context: CommentWriteContext,
    commentId: string,
    body: string,
  ): Promise<CommentOutcome> {
    const comment = await this.requireVisibleComment(context, commentId);
    // A text that is already there is not written again: no new time, no new mentions.
    const isUnchanged =
      comment.authorId === context.actor.id && comment.body === body.trim();
    if (!isUnchanged)
      await context.comments.edit(context.actor, comment.id, body);
    return this.changed(comment, "edited", !isUnchanged);
  }

  private async resolve(
    context: CommentWriteContext,
    commentId: string,
    isResolved: boolean,
  ): Promise<CommentOutcome> {
    const comment = await this.requireVisibleComment(context, commentId);
    // Only the first comment of a thread is resolved; a reply never is.
    if (comment.parentId !== null)
      throw new AgentOperationError("INVALID_REQUEST");
    // A thread that is in the requested state keeps who resolved it, and when.
    const hasChanged = (comment.resolvedAt !== null) !== isResolved;
    if (hasChanged)
      await context.comments.resolve(context.actor, comment.id, isResolved);
    return this.changed(
      comment,
      isResolved ? "resolved" : "reopened",
      hasChanged,
    );
  }

  private async remove(
    context: CommentWriteContext,
    commentId: string,
  ): Promise<CommentOutcome> {
    const comment = await this.requireVisibleComment(context, commentId);
    const onPage = await context.wiki.comments.listByPage(comment.pageId);
    const removed = onPage.filter(
      (entry) => entry.id === comment.id || entry.parentId === comment.id,
    );
    await context.comments.remove(context.actor, comment.id);
    return this.changed(comment, "deleted", true, removed.length);
  }

  /** A comment on a page the account cannot see is reported like a comment that does not exist. */
  private async requireVisibleComment(
    context: CommentWriteContext,
    commentId: string,
  ): Promise<StoredWikiComment> {
    const comment = await context.wiki.comments.find(commentId);
    if (!comment) throw new AgentOperationError("NOT_FOUND");
    await context.reader.require(context.viewer.scope, comment.pageId);
    return comment;
  }

  private changed(
    comment: StoredWikiComment,
    action: AgentWikiCommentChanged["action"],
    hasChanged: boolean,
    deletedComments = 0,
  ): CommentOutcome {
    return {
      result: {
        commentId: comment.id,
        pageId: comment.pageId,
        link: pageLink(comment.pageId),
        action,
        changed: hasChanged,
        deletedComments,
      },
      changedPageId: hasChanged ? comment.pageId : null,
    };
  }
}
