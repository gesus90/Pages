import { z } from "zod";

import {
  recordInterfaceOperation,
  replayInterfaceOperation,
} from "@/backend/service/InterfaceOperationJournal";
import { WIKI_SCOPE } from "@/definition/Wiki";

import { McpWikiError } from "./McpWikiError";
import {
  currentPage,
  pageName,
  projectPage,
  projectSearchResult,
} from "./McpWikiProjection";

import type { InterfaceOperation } from "@/backend/service/InterfaceOperationJournal";
import type { MoveWikiPageInput } from "@/backend/service/WikiService";
import type { WikiPage, WikiPageView, WikiScope } from "@/definition/Wiki";
import type {
  McpWikiMovePreview,
  McpWikiPage,
  McpWikiPageRead,
  McpWikiSearchResult,
  McpWikiTree,
} from "./McpWikiContract";
import type { McpWikiContext } from "./McpWikiContext";
import type {
  McpWikiCreateRequest,
  McpWikiDuplicateRequest,
  McpWikiMoveRequest,
  McpWikiPatchRequest,
  McpWikiPropertiesRequest,
  McpWikiSearchRequest,
  McpWikiTreeRequest,
  McpWikiUpdateRequest,
} from "./McpWikiRequest";

/** What a save with an operation ID stores; a repetition answers the page as it is then. */
const savedRevisionSchema = z.object({ revision: z.number().int().positive() });

/** A page answer of a writing request. */
interface PageAnswer {
  readonly page: McpWikiPage;
}

/** Title, text and icon of a save; the rest of the page stays as it is. */
interface PageEdit {
  readonly title: string;
  readonly content: string;
  readonly icon: string | null;
}

/**
 * Replaces the one place of a text that equals `oldText`.
 *
 * @param content - The Markdown of the page.
 * @param oldText - The passage to replace; it must occur exactly once.
 * @param newText - The passage that takes its place.
 * @returns The text with the passage replaced.
 * @throws {McpWikiError} `text_not_found` when the passage does not occur,
 * `text_not_unique` when it occurs more than once, overlapping places included.
 */
export function replaceUniquePassage(
  content: string,
  oldText: string,
  newText: string,
): string {
  const index = content.indexOf(oldText);
  if (index < 0) throw new McpWikiError("text_not_found");
  if (content.indexOf(oldText, index + 1) >= 0)
    throw new McpWikiError("text_not_unique");
  return `${content.slice(0, index)}${newText}${content.slice(index + oldText.length)}`;
}

/** Rejects a project for any scope but `project`, where only it applies. */
function requireProjectOnlyForProjectScope(
  scope: string | undefined,
  projectId: string | null | undefined,
): void {
  const hasProject = projectId !== null && projectId !== undefined;
  if (hasProject && scope !== undefined && scope !== WIKI_SCOPE.PROJECT)
    throw new McpWikiError("invalid_request");
}

/** The project of a move: the named one, else that of the page while the scope stays. */
function projectOfMove(
  page: WikiPage,
  scope: WikiScope,
  request: McpWikiMoveRequest,
): string | null {
  if (request.projectId !== undefined) return request.projectId;
  return scope === page.scope ? page.projectId : null;
}

/** The place of a move, with scope and project of the page where the request names none. */
function placementOf(
  page: WikiPage,
  request: McpWikiMoveRequest,
): MoveWikiPageInput {
  const scope = request.scope ?? page.scope;
  return {
    scope,
    projectId: projectOfMove(page, scope, request),
    parentId: request.parentId ?? null,
    beforeId: request.beforeId ?? null,
  };
}

/**
 * Reads, searches, creates, changes and moves pages (PAGE-257, interface 1–8 and 10).
 *
 * @remarks
 * Every call goes through the announcing wiki service of the interface. A
 * change bound to a revision reads the page and changes it in one call, so a
 * client that read an older revision gets `conflict` and nothing changes.
 */
export class McpWikiPageService {
  /**
   * Lists the visible pages of the navigation.
   *
   * @param context - The request.
   * @param request - Optional project and scope.
   * @throws {McpWikiError} `not_found` for a project the account does not see.
   */
  public async tree(
    context: McpWikiContext,
    request: McpWikiTreeRequest,
  ): Promise<McpWikiTree> {
    requireProjectOnlyForProjectScope(request.scope, request.projectId);
    const navigation = await context.services.wiki.navigation(context.actor);
    const { projectId, scope } = request;
    if (
      projectId !== undefined &&
      !navigation.projects.some((project) => project.id === projectId)
    )
      throw new McpWikiError("not_found");
    return {
      pages: navigation.nodes.filter(
        (node) =>
          (scope === undefined || node.scope === scope) &&
          (projectId === undefined || node.projectId === projectId),
      ),
      projects: navigation.projects
        .filter(
          (project) =>
            (projectId === undefined || project.id === projectId) &&
            (scope === undefined || scope === WIKI_SCOPE.PROJECT),
        )
        .map(({ id, name }) => ({ id, name })),
      canCreate: navigation.canCreate,
    };
  }

  /**
   * Searches titles and texts like the search dialog of the interface.
   *
   * @param context - The request.
   * @param request - The text and an optional project.
   * @returns The hits in the order of the interface, best first.
   */
  public async search(
    context: McpWikiContext,
    request: McpWikiSearchRequest,
  ): Promise<{ readonly results: readonly McpWikiSearchResult[] }> {
    const response = await context.services.wiki.search(context.actor, {
      text: request.text,
      titleOnly: false,
      location:
        request.projectId === undefined ? null : `project:${request.projectId}`,
      underPageId: null,
      creatorId: null,
      editedFrom: null,
      editedTo: null,
      sort: null,
    });
    return { results: response.results.map(projectSearchResult) };
  }

  /**
   * Reads a page, optionally with the pages that mention it.
   *
   * @param context - The request.
   * @param id - Page identifier.
   * @param withBacklinks - Whether the answer names the mentioning pages.
   */
  public async read(
    context: McpWikiContext,
    id: string,
    withBacklinks: boolean,
  ): Promise<McpWikiPageRead> {
    const page = await projectPage(context, await context.page(id));
    if (!withBacklinks) return { page };
    const backlinks = await context.services.wiki.backlinks(context.actor, id);
    return { page, backlinks: backlinks.pages.map(pageName) };
  }

  /**
   * Creates a page; the account becomes its owner.
   *
   * @param context - The request.
   * @param request - Place, title, text and icon.
   */
  public async create(
    context: McpWikiContext,
    request: McpWikiCreateRequest,
  ): Promise<PageAnswer> {
    requireProjectOnlyForProjectScope(request.scope, request.projectId);
    const created = await context.services.wiki.create(context.actor, {
      title: request.title,
      parentId: request.parentId ?? null,
      scope: request.scope,
      projectId: request.projectId ?? null,
      content: request.content ?? "",
      icon: request.icon ?? null,
      anchors: [],
      templateId: null,
      isTemplate: false,
    });
    return currentPage(context, created.id);
  }

  /**
   * Saves title, text or icon against the revision the client read.
   *
   * @param context - The request.
   * @param id - Page identifier.
   * @param request - The changed fields; the others keep their stored value.
   */
  public async update(
    context: McpWikiContext,
    id: string,
    request: McpWikiUpdateRequest,
  ): Promise<PageAnswer> {
    return this.save(context, id, {
      expectedRevision: request.expectedRevision,
      operationId: request.operationId,
      operation: "mcp.wiki.update",
      request: {
        title: request.title,
        content: request.content,
        icon: request.icon,
      },
      edit: (page) => ({
        title: request.title ?? page.title,
        content: request.content ?? page.content,
        icon: request.icon === undefined ? page.icon : request.icon,
      }),
    });
  }

  /**
   * Replaces the one passage of the text that equals `oldText` and saves the
   * result like any save of the interface, with a version and its events.
   *
   * @param context - The request.
   * @param id - Page identifier.
   * @param request - The passage, its replacement and the revision read.
   */
  public async patch(
    context: McpWikiContext,
    id: string,
    request: McpWikiPatchRequest,
  ): Promise<PageAnswer> {
    return this.save(context, id, {
      expectedRevision: request.expectedRevision,
      operationId: request.operationId,
      operation: "mcp.wiki.patch",
      request: { oldText: request.oldText, newText: request.newText },
      edit: (page) => ({
        title: page.title,
        content: replaceUniquePassage(
          page.content,
          request.oldText,
          request.newText,
        ),
        icon: page.icon,
      }),
    });
  }

  /**
   * Copies a page, optionally with the pages below it.
   *
   * @param context - The request.
   * @param id - Page to copy.
   * @param request - Title of the copy and whether the children go along.
   */
  public async duplicate(
    context: McpWikiContext,
    id: string,
    request: McpWikiDuplicateRequest,
  ): Promise<PageAnswer> {
    const copy = await context.services.wiki.duplicate(context.actor, id, {
      title: request.title,
      withChildren: request.withChildren ?? false,
      isTemplate: false,
    });
    return currentPage(context, copy.id);
  }

  /**
   * Moves a page with its subtree, or tells how the move would change who sees it.
   *
   * @param context - The request.
   * @param id - Page identifier.
   * @param request - The new place, the revision read and whether only to preview.
   */
  public async move(
    context: McpWikiContext,
    id: string,
    request: McpWikiMoveRequest,
  ): Promise<PageAnswer | McpWikiMovePreview> {
    requireProjectOnlyForProjectScope(request.scope, request.projectId);
    const { actor, services } = context;
    return context.atomically(async () => {
      const { page } = await context.pageAtRevision(
        id,
        request.expectedRevision,
      );
      const placement = placementOf(page, request);
      if (request.preview === true)
        return {
          preview: await services.wiki.previewMove(actor, id, placement),
        };
      await services.wiki.move(actor, id, placement);
      return currentPage(context, id);
    });
  }

  /**
   * Changes owner, review date or anchors of a page in one call.
   *
   * @param context - The request.
   * @param id - Page identifier.
   * @param request - The properties to change; `anchors` replaces every anchor.
   */
  public async setProperties(
    context: McpWikiContext,
    id: string,
    request: McpWikiPropertiesRequest,
  ): Promise<PageAnswer> {
    const { actor, services } = context;
    return context.atomically(async () => {
      await context.page(id);
      if (request.owner !== undefined)
        await services.wiki.setOwner(
          actor,
          id,
          await context.requireOwnerCandidate(request.owner),
        );
      if (request.currentUntil !== undefined)
        await services.wiki.setCurrentUntil(actor, id, request.currentUntil);
      if (request.anchors !== undefined)
        await services.wiki.setAnchors(actor, id, request.anchors);
      return currentPage(context, id);
    });
  }

  /**
   * Saves an edit through the save of the interface, bound to a revision and
   * optionally to an operation ID.
   *
   * @remarks
   * The page is read and saved in one call. A repeated operation ID with the
   * same request changes nothing again and answers the page as it is; the
   * same ID with another request is `invalid_request`.
   */
  private async save(
    context: McpWikiContext,
    id: string,
    input: {
      readonly expectedRevision: number;
      readonly operationId: string | undefined;
      readonly operation: string;
      readonly request: Readonly<Record<string, string | null | undefined>>;
      readonly edit: (page: WikiPage) => PageEdit;
    },
  ): Promise<PageAnswer> {
    const { actor, services } = context;
    const operation: InterfaceOperation | null =
      input.operationId === undefined
        ? null
        : {
            userId: actor.id,
            operation: input.operation,
            operationId: input.operationId,
            request: {
              id,
              expectedRevision: input.expectedRevision,
              ...input.request,
            },
          };
    return context.atomically(async () => {
      const view: WikiPageView = await context.page(id);
      if (operation !== null) {
        const replayed = await replayInterfaceOperation(
          services.operations,
          operation,
          savedRevisionSchema,
        );
        if (replayed !== null)
          return { page: await projectPage(context, view) };
      }
      if (view.page.revision !== input.expectedRevision)
        throw new McpWikiError("conflict", view.page.revision);
      // Each save of a machine keeps the previous text as its own version, so
      // every change stays reachable in the history, also within ten minutes.
      const saved = await services.wiki.update(actor, id, {
        ...input.edit(view.page),
        expectedRevision: input.expectedRevision,
        coalesceVersions: false,
      });
      if (operation !== null)
        await recordInterfaceOperation(services.operations, operation, {
          revision: saved.revision,
        });
      return currentPage(context, id);
    });
  }
}
