import {
  currentPage,
  pageName,
  projectTrashEntry,
  projectVersion,
  projectVersionSummary,
} from "./McpWikiProjection";

import type {
  McpWikiDeleteConfirmation,
  McpWikiPage,
  McpWikiPurgeConfirmation,
  McpWikiTrashEntry,
  McpWikiVersion,
  McpWikiVersionSummary,
} from "./McpWikiContract";
import type { McpWikiContext } from "./McpWikiContext";
import type { McpWikiDeleteRequest } from "./McpWikiRequest";

/**
 * Moves pages into the trash, brings them back, removes them for good and
 * restores versions (PAGE-257, interface 9 and 11–14).
 *
 * @remarks
 * Every call goes through the announcing wiki service of the interface. A
 * move into the trash and a purge change nothing until the client confirms
 * the pages they affect.
 */
export class McpWikiLifecycleService {
  /**
   * Moves a page with its subtree into the trash after a confirmed question.
   *
   * @param context - The request.
   * @param id - Page identifier.
   * @param request - The revision read and the confirmation.
   * @returns The question with every affected page, or `{ deleted: true }`.
   * @throws {McpWikiError} `conflict` when the page has another revision.
   */
  public async delete(
    context: McpWikiContext,
    id: string,
    request: McpWikiDeleteRequest,
  ): Promise<McpWikiDeleteConfirmation | { readonly deleted: true }> {
    const { actor, services } = context;
    if (request.confirmed !== true) {
      await context.pageAtRevision(id, request.expectedRevision);
      const scope = await services.wiki.previewDelete(actor, id);
      return {
        confirmationRequired: true,
        page: pageName(scope.page),
        affected: scope.affected.map(pageName),
      };
    }
    await context.atomically(async () => {
      await context.pageAtRevision(id, request.expectedRevision);
      await services.wiki.delete(actor, id);
    });
    return { deleted: true };
  }

  /**
   * Lists the pages in the trash the account may restore.
   *
   * @param context - The request.
   */
  public async trash(
    context: McpWikiContext,
  ): Promise<{ readonly pages: readonly McpWikiTrashEntry[] }> {
    const entries = await context.services.wiki.listTrash(context.actor);
    return { pages: entries.map(projectTrashEntry) };
  }

  /**
   * Brings a page back from the trash with the pages deleted with it.
   *
   * @param context - The request.
   * @param id - Page that was deleted as such.
   */
  public async restore(
    context: McpWikiContext,
    id: string,
  ): Promise<{ readonly page: McpWikiPage }> {
    await context.services.wiki.restore(context.actor, id);
    return currentPage(context, id);
  }

  /**
   * Removes a page from the trash for good after a confirmed question.
   *
   * @param context - The request.
   * @param id - Page that was deleted as such.
   * @param request - The confirmation.
   * @returns The question with every affected page and the number of
   * attachments, or `{ purged: true }`.
   * @throws {McpWikiError} `invalid_request` for a page that is not in the trash.
   */
  public async purge(
    context: McpWikiContext,
    id: string,
    request: { readonly confirmed?: boolean },
  ): Promise<McpWikiPurgeConfirmation | { readonly purged: true }> {
    const { actor, services } = context;
    if (request.confirmed !== true) {
      const scope = await services.wiki.previewPurge(actor, id);
      return {
        confirmationRequired: true,
        page: pageName(scope.page),
        affected: scope.affected.map(pageName),
        attachmentCount: scope.attachmentCount,
      };
    }
    await services.wiki.purge(actor, id);
    return { purged: true };
  }

  /**
   * Lists the versions of a page, newest first.
   *
   * @param context - The request.
   * @param id - Page identifier.
   */
  public async versions(
    context: McpWikiContext,
    id: string,
  ): Promise<{ readonly versions: readonly McpWikiVersionSummary[] }> {
    const versions = await context.services.wiki.listVersions(
      context.actor,
      id,
    );
    return {
      versions: await Promise.all(
        versions.map((version) => projectVersionSummary(context, version)),
      ),
    };
  }

  /**
   * Reads one version of a page with its text.
   *
   * @param context - The request.
   * @param id - Page identifier.
   * @param versionId - Version identifier.
   */
  public async version(
    context: McpWikiContext,
    id: string,
    versionId: string,
  ): Promise<{ readonly version: McpWikiVersion }> {
    const version = await context.services.wiki.getVersion(
      context.actor,
      id,
      versionId,
    );
    return { version: await projectVersion(context, version) };
  }

  /**
   * Replaces a page with the text of an earlier version, as a new version on top.
   *
   * @param context - The request.
   * @param id - Page identifier.
   * @param versionId - Version to take title and text from.
   * @param expectedRevision - The revision the client read.
   */
  public async restoreVersion(
    context: McpWikiContext,
    id: string,
    versionId: string,
    expectedRevision: number,
  ): Promise<{ readonly page: McpWikiPage }> {
    const { actor, services } = context;
    return context.atomically(async () => {
      await context.pageAtRevision(id, expectedRevision);
      await services.wiki.restoreVersion(actor, id, versionId);
      return currentPage(context, id);
    });
  }
}
