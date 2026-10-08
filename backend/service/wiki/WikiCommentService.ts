import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { countCharacters, WIKI_LIMITS, WIKI_SCOPE } from "@/definition/Wiki";

import { WikiPageReader } from "./WikiPageReader";
import { syncMentions } from "./WikiMentions";
import { collapseWhitespace, toPlainText } from "./WikiPlainText";

import type {
  StoredWikiComment,
  WikiPageRecord,
  WikiRepository,
} from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiComment, WikiCommentThread } from "@/definition/Wiki";
import type { WikiAccess, WikiViewer } from "./WikiAccess";

/** What a person writes into the comment box. */
export interface CommentInput {
  readonly body: string;
  /** The comment this one answers; `null` for a first comment. */
  readonly parentId: string | null;
  /** The passage the comment refers to, with its surroundings. */
  readonly quote: string | null;
  readonly quotePrefix: string | null;
  readonly quoteSuffix: string | null;
}

/** Longest quoted passage and longest piece of its surroundings. */
const QUOTE_LENGTH = 500;
const CONTEXT_LENGTH = 40;

function cut(text: string | null, length: number): string | null {
  const trimmed = text?.trim() ?? "";

  return trimmed === "" ? null : Array.from(trimmed).slice(0, length).join("");
}

function normalizeBody(body: string): string {
  const trimmed = body.trim();

  if (trimmed === "") {
    throw new WikiValidationError("commentRequired");
  }

  if (countCharacters(trimmed) > WIKI_LIMITS.commentLength) {
    throw new WikiValidationError("commentTooLong");
  }

  return trimmed;
}

/**
 * Decides who may change or delete a comment: its author, the owner of the
 * page and administrators; administrators not on private pages (T4.9.11).
 */
function canChangeComment(
  viewer: WikiViewer,
  page: WikiPageRecord,
  comment: StoredWikiComment,
): boolean {
  return (
    comment.authorId === viewer.scope.userId ||
    page.ownerId === viewer.scope.userId ||
    (viewer.scope.isAdmin && page.scope !== WIKI_SCOPE.PRIVATE)
  );
}

function toComment(
  viewer: WikiViewer,
  page: WikiPageRecord,
  comment: StoredWikiComment,
  plainText: string,
): WikiComment {
  return {
    authorId: comment.authorId,
    authorName: comment.authorName,
    body: comment.body,
    canChange: canChangeComment(viewer, page, comment),
    canEdit: comment.authorId === viewer.scope.userId,
    createdAt: comment.createdAt,
    id: comment.id,
    isStale:
      comment.quote !== null &&
      !plainText.includes(collapseWhitespace(comment.quote)),
    pageId: comment.pageId,
    quote: comment.quote,
    quotePrefix: comment.quotePrefix,
    quoteSuffix: comment.quoteSuffix,
    resolvedAt: comment.resolvedAt,
    resolvedByName: comment.resolvedByName,
    updatedAt: comment.updatedAt,
  };
}

/** Writes, answers and resolves comments of pages the person sees. */
export class WikiCommentService {
  private readonly repository: WikiRepository;
  private readonly access: WikiAccess;

  /**
   * Creates the service.
   *
   * @param repository - Wiki persistence.
   * @param access - Resolves who is acting.
   */
  public constructor(repository: WikiRepository, access: WikiAccess) {
    this.repository = repository;
    this.access = access;
  }

  /**
   * Lists the comments of a page as threads.
   *
   * @param actor - The signed-in user.
   * @param pageId - Page identifier.
   * @returns First comments, oldest first, each with its replies. A comment
   * on a passage that is gone from the text is marked as stale.
   * @throws {WikiPageNotFoundError} When the person may not see the page.
   */
  public async list(actor: User, pageId: string): Promise<WikiCommentThread[]> {
    const viewer = await this.access.resolve(actor);
    const page = await new WikiPageReader(this.repository).require(
      viewer.scope,
      pageId,
    );
    const plainText = toPlainText(page.content);
    const comments = (await this.repository.comments.listByPage(pageId)).map(
      (comment) => ({
        parentId: comment.parentId,
        view: toComment(viewer, page, comment, plainText),
      }),
    );

    return comments
      .filter((comment) => comment.parentId === null)
      .map((root) => ({
        comment: root.view,
        replies: comments
          .filter((reply) => reply.parentId === root.view.id)
          .map((reply) => reply.view),
      }));
  }

  /**
   * Adds a comment or a reply.
   *
   * @param actor - The signed-in user; anybody who sees the page may comment.
   * @param pageId - Page identifier.
   * @param input - Text, reply target and quoted passage.
   * @returns The new comment.
   * @throws {WikiValidationError} For an empty or too long text, or a reply
   * to something that is not a first comment of this page.
   */
  public async add(
    actor: User,
    pageId: string,
    input: CommentInput,
  ): Promise<WikiComment> {
    const viewer = await this.access.resolve(actor);
    const body = normalizeBody(input.body);

    return this.repository.transaction(async (repository) => {
      const page = await new WikiPageReader(repository).require(
        viewer.scope,
        pageId,
      );

      await this.requireRoot(repository, pageId, input.parentId);

      const id = await repository.comments.insert({
        authorId: actor.id,
        body,
        pageId,
        parentId: input.parentId,
        quote: cut(input.quote, QUOTE_LENGTH),
        quotePrefix: cut(input.quotePrefix, CONTEXT_LENGTH),
        quoteSuffix: cut(input.quoteSuffix, CONTEXT_LENGTH),
      });

      await this.recordMentions(repository, page, {
        authorId: actor.id,
        commentId: id,
        text: body,
      });

      return toComment(
        viewer,
        page,
        await this.requireComment(repository, id),
        toPlainText(page.content),
      );
    });
  }

  /**
   * Changes the text of a comment.
   *
   * @param actor - The signed-in user; only the author.
   * @param id - Comment identifier.
   * @param body - The new text.
   * @throws {WikiAccessDeniedError} When the comment is somebody else's.
   * @throws {WikiValidationError} For an empty or too long text.
   */
  public async edit(actor: User, id: string, body: string): Promise<void> {
    const viewer = await this.access.resolve(actor);
    const text = normalizeBody(body);

    await this.repository.transaction(async (repository) => {
      const { comment, page } = await this.load(repository, viewer, id);

      if (comment.authorId !== actor.id) {
        throw new WikiAccessDeniedError();
      }

      await repository.comments.updateBody(id, text);
      await this.recordMentions(repository, page, {
        authorId: actor.id,
        commentId: id,
        text,
      });
    });
  }

  /**
   * Deletes a comment with its replies.
   *
   * @param actor - The signed-in user; the author, the owner of the page or
   * an administrator (not on private pages).
   * @param id - Comment identifier.
   * @throws {WikiAccessDeniedError} For anybody else.
   */
  public async remove(actor: User, id: string): Promise<void> {
    const viewer = await this.access.resolve(actor);

    await this.repository.transaction(async (repository) => {
      const { comment, page } = await this.load(repository, viewer, id);

      if (!canChangeComment(viewer, page, comment)) {
        throw new WikiAccessDeniedError();
      }

      await repository.comments.delete(id);
    });
  }

  /**
   * Resolves a thread, or opens it again.
   *
   * @param actor - The signed-in user; anybody who sees the page.
   * @param id - Identifier of the first comment of the thread.
   * @param isResolved - Whether the thread is resolved afterwards.
   * @throws {WikiValidationError} When the comment is a reply.
   */
  public async resolve(
    actor: User,
    id: string,
    isResolved: boolean,
  ): Promise<void> {
    const viewer = await this.access.resolve(actor);

    await this.repository.transaction(async (repository) => {
      const { comment } = await this.load(repository, viewer, id);

      if (comment.parentId !== null) {
        throw new WikiValidationError("invalidParent");
      }

      await repository.comments.setResolved(id, isResolved ? actor.id : null);
    });
  }

  private async load(
    repository: WikiRepository,
    viewer: WikiViewer,
    id: string,
  ): Promise<{ comment: StoredWikiComment; page: WikiPageRecord }> {
    const comment = await this.requireComment(repository, id);
    const page = await new WikiPageReader(repository).require(
      viewer.scope,
      comment.pageId,
    );

    return { comment, page };
  }

  private async requireComment(
    repository: WikiRepository,
    id: string,
  ): Promise<StoredWikiComment> {
    const comment = await repository.comments.find(id);

    if (!comment) {
      throw new WikiPageNotFoundError();
    }

    return comment;
  }

  private async requireRoot(
    repository: WikiRepository,
    pageId: string,
    parentId: string | null,
  ): Promise<void> {
    if (parentId === null) {
      return;
    }

    const parent = await repository.comments.find(parentId);

    if (parent?.pageId !== pageId || parent.parentId !== null) {
      throw new WikiValidationError("invalidParent");
    }
  }

  private async recordMentions(
    repository: WikiRepository,
    page: WikiPageRecord,
    comment: { authorId: string; commentId: string; text: string },
  ): Promise<void> {
    if (page.scope !== WIKI_SCOPE.PRIVATE) {
      await syncMentions(repository, { ...comment, pageId: page.id });
    }
  }
}
