import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";

/** Establishes the business-logic boundary for wiki pages. */
export class WikiService {
  private readonly wikiRepository: WikiRepository;

  /**
   * Creates a wiki service.
   *
   * @param wikiRepository - Wiki persistence boundary.
   */
  public constructor(wikiRepository: WikiRepository) {
    this.wikiRepository = wikiRepository;
  }
}
