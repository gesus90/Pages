import type {
  WikiTrashEntry,
  WikiVersion,
  WikiVersionSummary,
} from "@/backend/database/repositories/WikiRepository";
import type { WikiCommentEntry } from "@/backend/service/WikiService";
import type {
  WikiAttachment,
  WikiPageLink,
  WikiPageView,
  WikiSearchResult,
} from "@/definition/Wiki";
import type {
  McpWikiAttachment,
  McpWikiComment,
  McpWikiPage,
  McpWikiPageName,
  McpWikiSearchResult,
  McpWikiTrashEntry,
  McpWikiVersion,
  McpWikiVersionSummary,
} from "./McpWikiContract";
import type { McpWikiContext } from "./McpWikiContext";

/**
 * Names a page by identifier and title only.
 *
 * @param page - Any page with an identifier and a title.
 */
export function pageName(
  page: Pick<WikiPageLink, "id" | "title">,
): McpWikiPageName {
  return { id: page.id, title: page.title };
}

/**
 * Builds the answer object "Seite" from the page view of the interface.
 *
 * @param context - The request, which names the owner by username.
 * @param view - The page with the rights of the account.
 */
export async function projectPage(
  context: McpWikiContext,
  view: WikiPageView,
): Promise<McpWikiPage> {
  const { page } = view;
  return {
    id: page.id,
    title: page.title,
    icon: page.icon,
    scope: page.scope,
    projectId: page.projectId,
    projectName: page.projectName,
    parentId: page.parentId,
    owner: await context.person(page.ownerId, page.ownerName),
    currentUntil: page.currentUntil,
    content: page.content,
    revision: page.revision,
    isTemplate: page.isTemplate,
    anchors: page.anchors.map(({ kind, targetId, label }) => ({
      kind,
      targetId,
      label,
    })),
    breadcrumb: page.breadcrumb.map(pageName),
    children: view.children.map(pageName),
    permissions: {
      canEdit: view.permissions.canEdit,
      canManage: view.permissions.canManage,
      canComment: view.permissions.canComment,
    },
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

/**
 * Reads a page anew and answers it as `{ page }`.
 *
 * @param context - The request.
 * @param id - Page identifier.
 */
export async function currentPage(
  context: McpWikiContext,
  id: string,
): Promise<{ readonly page: McpWikiPage }> {
  return { page: await projectPage(context, await context.page(id)) };
}

/** One hit of the search, without its passage and owner. */
export function projectSearchResult(
  result: WikiSearchResult,
): McpWikiSearchResult {
  return {
    id: result.id,
    title: result.title,
    icon: result.icon,
    scope: result.scope,
    projectId: result.projectId,
    projectName: result.projectName,
    parentId: result.parentId,
    updatedAt: result.updatedAt,
  };
}

/** One page of the trash, without who deleted it. */
export function projectTrashEntry(entry: WikiTrashEntry): McpWikiTrashEntry {
  return {
    id: entry.id,
    title: entry.title,
    scope: entry.scope,
    projectId: entry.projectId,
    deletedAt: entry.deletedAt,
  };
}

/**
 * One version of a page without its text.
 *
 * @param context - The request, which names the author by username.
 * @param version - The stored version.
 */
export async function projectVersionSummary(
  context: McpWikiContext,
  version: WikiVersionSummary,
): Promise<McpWikiVersionSummary> {
  return {
    id: version.id,
    revision: version.revision,
    title: version.title,
    author: await context.person(version.authorId, version.authorName),
    createdAt: version.createdAt,
  };
}

/**
 * One version of a page with its text.
 *
 * @param context - The request, which names the author by username.
 * @param version - The stored version.
 */
export async function projectVersion(
  context: McpWikiContext,
  version: WikiVersion,
): Promise<McpWikiVersion> {
  return {
    ...(await projectVersionSummary(context, version)),
    content: version.content,
  };
}

/**
 * The answer object "Kommentar".
 *
 * @param context - The request, which names the author by username.
 * @param entry - The comment and the first comment it answers.
 */
export async function projectComment(
  context: McpWikiContext,
  entry: WikiCommentEntry,
): Promise<McpWikiComment> {
  const { comment } = entry;
  return {
    id: comment.id,
    parentId: entry.parentId,
    author: await context.person(comment.authorId, comment.authorName),
    body: comment.body,
    quote: comment.quote,
    resolvedAt: comment.resolvedAt,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

/** The answer object "Anhang", without the page, the uploader or a storage name. */
export function projectAttachment(
  attachment: WikiAttachment,
): McpWikiAttachment {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    kind: attachment.kind,
    size: attachment.size,
    createdAt: attachment.createdAt,
  };
}
