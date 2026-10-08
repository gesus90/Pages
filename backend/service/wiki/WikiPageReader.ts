import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { WikiPageRecord } from "@/backend/database/repositories/WikiRepository";
import type { WikiPage, WikiVisibilityScope } from "@/definition/Wiki";

/** Reads pages for a viewer and completes them with their derived parts. */
export class WikiPageReader {
  private readonly repository: WikiRepository;

  /**
   * Creates the reader.
   *
   * @param repository - Wiki persistence, possibly bound to a transaction.
   */
  public constructor(repository: WikiRepository) {
    this.repository = repository;
  }

  /**
   * Reads a page the viewer may see.
   *
   * @param scope - What the viewer may see.
   * @param id - Page identifier.
   * @returns The page.
   * @throws {WikiPageNotFoundError} When it is missing or hidden.
   */
  public async require(
    scope: WikiVisibilityScope,
    id: string,
  ): Promise<WikiPageRecord> {
    const page = await this.repository.pages.findVisible(scope, id);

    if (!page) {
      throw new WikiPageNotFoundError();
    }

    return page;
  }

  /**
   * Adds the anchors and the breadcrumb to a stored page.
   *
   * @param record - A page the viewer may see.
   * @returns The complete page.
   */
  public async assemble(record: WikiPageRecord): Promise<WikiPage> {
    const [anchors, breadcrumb] = await Promise.all([
      this.repository.anchors.findAnchors(record.id),
      this.repository.pages.findBreadcrumb(record.id),
    ]);

    return { ...record, anchors, breadcrumb };
  }
}
