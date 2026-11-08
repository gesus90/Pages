import { projectAttachment, projectComment } from "./McpWikiProjection";

import type {
  OpenedAttachment,
  UploadedFile,
} from "@/backend/service/WikiService";
import type { McpWikiAttachment, McpWikiComment } from "./McpWikiContract";
import type { McpWikiContext } from "./McpWikiContext";
import type { McpWikiCommentCreateRequest } from "./McpWikiRequest";

/**
 * The comments and attachments of pages (PAGE-257, interface 15 and 16).
 *
 * @remarks
 * Every call goes through the announcing wiki service of the interface,
 * which decides who may write, change, resolve or remove and announces the
 * change of the page it belongs to.
 */
export class McpWikiDetailService {
  /**
   * Lists the comments of a page, each first comment followed by its replies.
   *
   * @param context - The request.
   * @param pageId - Page identifier.
   */
  public async comments(
    context: McpWikiContext,
    pageId: string,
  ): Promise<{ readonly comments: readonly McpWikiComment[] }> {
    const threads = await context.services.wiki.listComments(
      context.actor,
      pageId,
    );
    const entries = threads.flatMap((thread) => [
      { comment: thread.comment, parentId: null },
      ...thread.replies.map((reply) => ({
        comment: reply,
        parentId: thread.comment.id,
      })),
    ]);
    return {
      comments: await Promise.all(
        entries.map((entry) => projectComment(context, entry)),
      ),
    };
  }

  /**
   * Adds a comment or a reply to a first comment.
   *
   * @param context - The request.
   * @param pageId - Page identifier.
   * @param request - Text, the first comment it answers and a quoted passage.
   */
  public async addComment(
    context: McpWikiContext,
    pageId: string,
    request: McpWikiCommentCreateRequest,
  ): Promise<{ readonly comment: McpWikiComment }> {
    const parentId = request.parentId ?? null;
    const comment = await context.services.wiki.addComment(
      context.actor,
      pageId,
      {
        body: request.body,
        parentId,
        quote: request.quote ?? null,
        quotePrefix: null,
        quoteSuffix: null,
      },
    );
    return { comment: await projectComment(context, { comment, parentId }) };
  }

  /**
   * Changes the text of a comment of the account.
   *
   * @param context - The request.
   * @param commentId - Comment identifier.
   * @param body - The new text.
   */
  public async editComment(
    context: McpWikiContext,
    commentId: string,
    body: string,
  ): Promise<{ readonly comment: McpWikiComment }> {
    await context.services.wiki.editComment(context.actor, commentId, body);
    return this.comment(context, commentId);
  }

  /**
   * Resolves a thread, or opens it again.
   *
   * @param context - The request.
   * @param commentId - Identifier of the first comment of the thread.
   * @param isResolved - Whether the thread is resolved afterwards.
   */
  public async resolveComment(
    context: McpWikiContext,
    commentId: string,
    isResolved: boolean,
  ): Promise<{ readonly comment: McpWikiComment }> {
    await context.services.wiki.resolveComment(
      context.actor,
      commentId,
      isResolved,
    );
    return this.comment(context, commentId);
  }

  /**
   * Removes a comment with its replies.
   *
   * @param context - The request.
   * @param commentId - Comment identifier.
   */
  public async removeComment(
    context: McpWikiContext,
    commentId: string,
  ): Promise<{ readonly deleted: true }> {
    await context.services.wiki.removeComment(context.actor, commentId);
    return { deleted: true };
  }

  /**
   * Lists the attachments of a page.
   *
   * @param context - The request.
   * @param pageId - Page identifier.
   */
  public async attachments(
    context: McpWikiContext,
    pageId: string,
  ): Promise<{ readonly attachments: readonly McpWikiAttachment[] }> {
    const attachments = await context.services.wiki.listAttachments(
      context.actor,
      pageId,
    );
    return { attachments: attachments.map(projectAttachment) };
  }

  /**
   * Attaches a file to a page with the limits of the instance.
   *
   * @param context - The request.
   * @param pageId - Page identifier.
   * @param file - The streamed upload.
   */
  public async upload(
    context: McpWikiContext,
    pageId: string,
    file: UploadedFile,
  ): Promise<{ readonly attachment: McpWikiAttachment }> {
    const attachment = await context.services.wiki.uploadAttachment(
      context.actor,
      pageId,
      file,
    );
    return { attachment: projectAttachment(attachment) };
  }

  /**
   * Opens an attachment for download.
   *
   * @param context - The request.
   * @param attachmentId - Attachment identifier.
   * @returns The attachment and its bytes; the storage name stays inside.
   */
  public async open(
    context: McpWikiContext,
    attachmentId: string,
  ): Promise<OpenedAttachment> {
    return context.services.wiki.openAttachment(context.actor, attachmentId);
  }

  /**
   * Removes an attachment and its file.
   *
   * @param context - The request.
   * @param attachmentId - Attachment identifier.
   */
  public async removeAttachment(
    context: McpWikiContext,
    attachmentId: string,
  ): Promise<{ readonly deleted: true }> {
    await context.services.wiki.removeAttachment(context.actor, attachmentId);
    return { deleted: true };
  }

  private async comment(
    context: McpWikiContext,
    commentId: string,
  ): Promise<{ readonly comment: McpWikiComment }> {
    const entry = await context.services.wiki.getComment(
      context.actor,
      commentId,
    );
    return { comment: await projectComment(context, entry) };
  }
}
